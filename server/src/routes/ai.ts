import { Router, Request, Response, NextFunction } from "express";
import { validateRepoPath } from "../middleware/validatePath";
import * as gitService from "../services/gitService";
import { withRepoLock } from "../services/gitService";
import {
  publicSettings,
  saveSettings,
  configured,
} from "../services/aiSettings";
import { randomUUID } from "crypto";
import { simpleGit } from "simple-git";
import { getModelCatalog } from '../services/modelCatalog';
import * as aiService from "../services/aiService";

const router = Router();

function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch((error) => {
      res.status(400).json({
        success: false,
        error:
          error?.name === "ZodError"
            ? "Invalid AI configuration or response"
            : error.message || "AI request failed",
      });
    });
  };
}

router.get('/models',asyncHandler(async(req,res)=>{res.json({success:true,data:await getModelCatalog(req.query.provider,req.query.refresh==='true')});}));

router.get(
  "/settings",
  asyncHandler(async (_req, res) => {
    res.json({ success: true, data: publicSettings() });
  }),
);
router.put(
  "/settings",
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: saveSettings(req.body) });
  }),
);
router.post(
  "/test",
  asyncHandler(async (_req, res) => {
    res.json({ success: true, data: await aiService.testConnection() });
  }),
);
router.use(validateRepoPath);
const plans = new Map<
  string,
  {
    repo: string;
    tree: string;
    head: string | null;
    files: string[];
    expires: number;
  }
>();
function git(repo: string) {
  return simpleGit(repo);
}
router.use((_req, _res, next) => {
  for (const [id, p] of plans) if (p.expires < Date.now()) plans.delete(id);
  next();
});

// Suggest commit message from staged changes
router.post(
  "/suggest",
  asyncHandler(async (req: Request, res: Response) => {
    const repoPath = (req as any).repoPath;
    configured();

    // 'eol': a CRLF -> LF rewrite makes every line of a file look changed, which
    // would otherwise flood the prompt with noise and skew the suggestion.
    const diff = await withRepoLock(repoPath, () =>
      gitService.getStagedDiff(repoPath, undefined, "eol"),
    );
    if (!diff.trim()) {
      res
        .status(400)
        .json({ success: false, error: "No staged changes to analyze" });
      return;
    }

    const result = await aiService.suggestCommitMessage(diff);
    res.json({ success: true, data: result });
  }),
);

// Suggest branch name and message for save-for-later
router.post(
  "/suggest-save-for-later",
  asyncHandler(async (req: Request, res: Response) => {
    const repoPath = (req as any).repoPath;
    configured();
    const { files } = req.body;

    if (!files || !Array.isArray(files) || files.length === 0) {
      res.status(400).json({ success: false, error: "No files provided" });
      return;
    }

    const status = await withRepoLock(repoPath, () =>
      gitService.getStatus(repoPath),
    );
    if (
      files.some(
        (f: any) =>
          typeof f !== "string" ||
          ![...status.staged, ...status.unstaged, ...status.untracked].some(
            (entry: any) =>
              (typeof entry === "string" ? entry : entry.path) === f,
          ),
      )
    )
      throw new Error("Select current changed files");
    const diff = await withRepoLock(repoPath, async () =>
      (
        await Promise.all(
          files.map((f: string) =>
            gitService.getDiff(repoPath, undefined, f, "eol"),
          ),
        )
      ).join("\n"),
    );
    const result = await aiService.suggestSaveForLater(files, diff || "");
    res.json({ success: true, data: result });
  }),
);

// Smart commit: analyze staged changes into groups (preview)
router.post(
  "/smart-commit/preview",
  asyncHandler(async (req: Request, res: Response) => {
    const repoPath = (req as any).repoPath;
    configured();

    const [diff, status, tree, head, stagedFiles] = await withRepoLock(
      repoPath,
      async () => {
        const d = await gitService.getStagedDiff(repoPath, undefined, "eol");
        const s = await gitService.getStatus(repoPath);
        const tree = (await git(repoPath).raw(["write-tree"])).trim();
        const head = await git(repoPath)
          .raw(["rev-parse", "--verify", "HEAD"])
          .then(
            (s) => s.trim(),
            () => null,
          );
        const files = (
          await git(repoPath).raw([
            "diff",
            "--cached",
            "--name-only",
            "--no-renames",
            "-z",
          ])
        )
          .split("\0")
          .filter(Boolean);
        return [d, s, tree, head, files] as const;
      },
    );

    if (!diff.trim() || status.staged.length === 0) {
      res
        .status(400)
        .json({ success: false, error: "No staged changes to analyze" });
      return;
    }

    const groups = await aiService.suggestSmartCommitGroups(diff, stagedFiles);

    const planId = randomUUID();
    if (plans.size >= 100) plans.delete(plans.keys().next().value!);
    plans.set(planId, {
      repo: repoPath,
      tree,
      head,
      files: stagedFiles,
      expires: Date.now() + 15 * 60 * 1000,
    });
    res.json({ success: true, data: { groups, planId } });
  }),
);

// Smart commit: execute with pre-defined groups (no AI call)
router.post(
  "/smart-commit/execute",
  asyncHandler(async (req: Request, res: Response) => {
    const repoPath = (req as any).repoPath;
    const { groups, planId } = req.body;
    const plan = plans.get(planId);
    if (!plan || plan.repo !== repoPath || plan.expires < Date.now())
      throw new Error("Preview expired. Generate a new preview.");
    const valid = aiService.groupSchema.array().min(1).max(100).parse(groups);
    aiService.validateGroups(valid, plan.files);
    const commits: { hash: string; message: string }[] = [];
    await withRepoLock(repoPath, async () => {
      const g = git(repoPath);
      if (
        (await g.raw(["write-tree"])).trim() !== plan.tree ||
        (await g.raw(["rev-parse", "--verify", "HEAD"]).then(
          (s) => s.trim(),
          () => null,
        )) !== plan.head
      )
        throw new Error(
          "Staged changes or HEAD changed. Generate a new preview.",
        );
      plans.delete(planId);
      try {
        await gitService.unstageAll(repoPath);
        for (const group of valid) {
          await g.raw([
            "restore",
            "--staged",
            "--source=" + plan.tree,
            "--",
            ...group.files.map(file => ":(literal)" + file),
          ]);
          const message = group.description
            ? group.title + "\n\n" + group.description
            : group.title;
          commits.push({
            hash: await gitService.commit(repoPath, message),
            message: group.title,
          });
        }
      } catch {
        await g.raw(["read-tree", plan.tree]);
        throw new Error(
          `Smart commit stopped after ${commits.length} commit(s). Remaining changes are staged; review the history before retrying.`,
        );
      }
    });

    res.json({ success: true, data: { commits } });
  }),
);

export default router;
