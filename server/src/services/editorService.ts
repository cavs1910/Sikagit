import fs from "fs";
import path from "path";
import { createHash, randomUUID } from "crypto";
import { execFileSync } from "child_process";
import { TextDecoder } from "util";
import { confinedFile, confinedRepo } from "../security";

export const MAX_TEXT_BYTES = 1024 * 1024;
const MAX_ENTRIES = 2000;
export class EditorError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
function target(repo: string, file: unknown, allowRoot = false): string {
  if (allowRoot && file === "") return confinedRepo(repo);
  if (typeof file !== "string") throw new EditorError("Invalid file path");
  const result = confinedFile(repo, file);
  const base = confinedRepo(repo);
  let current = base;
  for (const part of path.relative(base, result).split(path.sep)) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink())
      throw new EditorError("Symbolic links cannot be opened in the editor");
  }
  return result;
}
export function listDirectory(
  repo: string,
  directory: string,
  showIgnored: boolean,
) {
  const full = target(repo, directory, true);
  if (!fs.lstatSync(full).isDirectory())
    throw new EditorError("Not a directory");
  const entries = fs
    .readdirSync(full, { withFileTypes: true })
    .filter((e) => e.name !== ".git");
  if (entries.length > MAX_ENTRIES)
    throw new EditorError(
      "This directory has more than 2,000 entries. Open a smaller directory.",
    );
  let ignored = new Set<string>();
  const names = entries.map((e) =>
    directory ? directory + "/" + e.name : e.name,
  );
  if (!showIgnored && names.length) {
    let output: string;
    try {
      output = execFileSync("git", ["check-ignore", "-z", "--stdin"], {
        cwd: repo,
        input: names.join("\0") + "\0",
        encoding: "utf8",
        timeout: 10000,
        maxBuffer: 1024 * 1024,
      });
    } catch (e: any) {
      if (e.status !== 1) throw new EditorError("Cannot read Git ignore rules");
      output = e.stdout || "";
    }
    ignored = new Set(output.split("\0").filter(Boolean));
  }
  return entries
    .map((entry, i) => ({
      name: entry.name,
      path: names[i],
      type: entry.isSymbolicLink()
        ? "blocked"
        : entry.isDirectory()
          ? "directory"
          : entry.isFile()
            ? "file"
            : "blocked",
    }))
    .filter((entry) => !ignored.has(entry.path))
    .sort(
      (a, b) =>
        Number(b.type === "directory") - Number(a.type === "directory") ||
        a.name.localeCompare(b.name),
    );
}
function readTarget(full: string) {
  const descriptor = fs.openSync(
    full,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
  );
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.nlink !== 1)
      throw new EditorError(
        "Only regular files with a single hard link can be edited",
      );
    if (stat.size > MAX_TEXT_BYTES)
      throw new EditorError("The editor supports text files up to 1 MiB", 413);
    // A bounded read also protects against a file growing after the stat call.
    const buffer = Buffer.alloc(MAX_TEXT_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = fs.readSync(
        descriptor,
        buffer,
        length,
        buffer.length - length,
        null,
      );
      if (!count) break;
      length += count;
    }
    if (length > MAX_TEXT_BYTES)
      throw new EditorError("The editor supports text files up to 1 MiB", 413);
    const bytes = buffer.subarray(0, length);
    if (bytes.includes(0))
      throw new EditorError("Binary files cannot be edited");
    let content: string;
    try {
      content = new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(bytes);
    } catch {
      throw new EditorError("Only UTF-8 text files can be edited");
    }
    const after = fs.fstatSync(descriptor);
    if (
      stat.size !== after.size ||
      stat.mtimeMs !== after.mtimeMs ||
      stat.ctimeMs !== after.ctimeMs
    )
      throw new EditorError(
        "The file changed while being read. Try again.",
        409,
      );
    const revision = createHash("sha256")
      .update(bytes)
      .update(
        JSON.stringify([
          stat.dev,
          stat.ino,
          stat.mode,
          stat.mtimeMs,
          stat.ctimeMs,
        ]),
      )
      .digest("hex");
    const crlf = (content.match(/\r\n/g) || []).length;
    const lf = (content.match(/(?<!\r)\n/g) || []).length;
    if ((crlf && lf) || /\r(?!\n)/.test(content))
      throw new EditorError(
        "Mixed or legacy line endings are read-only. Normalize them outside the editor first.",
      );
    return {
      content,
      revision,
      lineEnding: crlf ? ("crlf" as const) : ("lf" as const),
      mode: stat.mode & 0o777,
    };
  } finally {
    fs.closeSync(descriptor);
  }
}
export function readText(repo: string, file: unknown) {
  const { mode, ...result } = readTarget(target(repo, file));
  return result;
}
export function writeText(
  repo: string,
  file: unknown,
  content: unknown,
  revision: unknown,
) {
  if (
    typeof content !== "string" ||
    typeof revision !== "string" ||
    !/^[a-f0-9]{64}$/.test(revision)
  )
    throw new EditorError(
      "Content and the original file revision are required",
    );
  if (Buffer.byteLength(content, "utf8") > MAX_TEXT_BYTES)
    throw new EditorError("The editor supports text files up to 1 MiB", 413);
  if (
    content.includes("\0") ||
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
      content,
    )
  )
    throw new EditorError("Content must be valid UTF-8 text");
  const full = target(repo, file);
  const original = readTarget(full);
  if (original.revision !== revision)
    throw new EditorError(
      "The file changed on the server. Your draft was kept. Reload the file before saving again.",
      409,
    );
  fs.accessSync(full, fs.constants.W_OK);
  const temporary = path.join(
    path.dirname(full),
    ".sikagit-edit-" + randomUUID(),
  );
  try {
    const fd = fs.openSync(
      temporary,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
      0o600,
    );
    try {
      fs.writeFileSync(fd, content, "utf8");
      fs.fchmodSync(fd, original.mode);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    if (target(repo, file) !== full || readTarget(full).revision !== revision)
      throw new EditorError(
        "The file changed on the server. Your draft was kept.",
        409,
      );
    fs.renameSync(temporary, full);
    return readText(repo, file);
  } finally {
    try {
      fs.unlinkSync(temporary);
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
    }
  }
}
