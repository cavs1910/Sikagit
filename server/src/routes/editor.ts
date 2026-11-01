import { Router, Request, Response, NextFunction } from "express";
import { validateRepoPath } from "../middleware/validatePath";
import { withRepoLock } from "../services/gitService";
import * as editor from "../services/editorService";
const router = Router();
router.use(validateRepoPath);
function handle(action: (req: Request) => unknown) {
  return (req: Request, res: Response, _next: NextFunction) => {
    withRepoLock((req as any).repoPath, async () => action(req))
      .then((data) => res.json({ success: true, data }))
      .catch((error) => {
        const status = error instanceof editor.EditorError ? error.status : 400;
        const message =
          error instanceof editor.EditorError
            ? error.message
            : error.code === "ENOENT"
              ? "File or directory no longer exists"
              : error.code === "EACCES"
                ? "Permission denied"
                : "Cannot access this path in the repository";
        res.status(status).json({ success: false, error: message });
      });
  };
}
router.get(
  "/tree",
  handle((req) =>
    editor.listDirectory(
      (req as any).repoPath,
      typeof req.query.directory === "string" ? req.query.directory : "",
      req.query.showIgnored === "true",
    ),
  ),
);
router.get(
  "/file",
  handle((req) => {
    const result = editor.readText((req as any).repoPath, req.query.file);
    return req.query.metadata === "true"
      ? { revision: result.revision }
      : result;
  }),
);
router.put(
  "/file",
  handle((req) =>
    editor.writeText(
      (req as any).repoPath,
      req.body.file,
      req.body.content,
      req.body.revision,
    ),
  ),
);
export default router;
