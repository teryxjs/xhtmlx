/**
 * @jest-environment node
 */
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const CLI = path.join(__dirname, "../../bin/xhtmlx-migrate.js");

function run(args) {
  return execSync("node " + CLI + " " + args, { encoding: "utf-8", timeout: 10000 }).trim();
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "xhtmlx-migrate-"));
}

describe("xhtmlx-migrate CLI", () => {
  test("--help shows usage", () => {
    const out = run("--help");
    expect(out).toContain("xhtmlx-migrate");
    expect(out).toContain("--from");
    expect(out).toContain("--to");
    expect(out).toContain("--dry-run");
  });

  test("no args shows usage", () => {
    const out = run("");
    expect(out).toContain("Usage");
  });

  test("--list-rules shows migration rules", () => {
    const out = run("--from=1 --to=2 --list-rules");
    expect(out).toContain("Migration:");
    expect(out).toContain("Rules");
    expect(out).toContain("xh-bind");
  });

  test("missing --from/--to shows error", () => {
    try {
      run("--from=1 somefile.html");
      expect(true).toBe(false); // should not reach
    } catch (e) {
      expect(e.stderr || e.message).toContain("--from and --to are required");
    }
  });

  test("invalid version pair shows error", () => {
    try {
      run("--from=99 --to=100 somefile.html");
      expect(true).toBe(false);
    } catch (e) {
      expect(e.stderr || e.message).toContain("No migration rules");
    }
  });

  test("--dry-run does not modify files", () => {
    const dir = tmpDir();
    const file = path.join(dir, "test.html");
    fs.writeFileSync(file, '<div xh-bind="name"></div>');

    const out = run("--from=1 --to=2 --dry-run " + file);
    expect(out).toContain("[would change]");
    expect(out).toContain("xh-bind renamed to xh-model");

    // File should NOT be modified
    const content = fs.readFileSync(file, "utf-8");
    expect(content).toContain("xh-bind");
    expect(content).not.toContain("xh-model");

    fs.rmSync(dir, { recursive: true });
  });

  test("renames xh-bind to xh-model", () => {
    const dir = tmpDir();
    const file = path.join(dir, "test.html");
    fs.writeFileSync(file, '<input xh-bind="username">');

    const out = run("--from=1 --to=2 " + file);
    expect(out).toContain("[changed]");

    const content = fs.readFileSync(file, "utf-8");
    expect(content).toContain("xh-model");
    expect(content).not.toContain("xh-bind");

    fs.rmSync(dir, { recursive: true });
  });

  test("renames xh-swap='replace' to 'outerHTML'", () => {
    const dir = tmpDir();
    const file = path.join(dir, "test.html");
    fs.writeFileSync(file, '<div xh-get="/api" xh-swap="replace"></div>');

    run("--from=1 --to=2 " + file);

    const content = fs.readFileSync(file, "utf-8");
    expect(content).toContain('xh-swap="outerHTML"');
    expect(content).not.toContain('xh-swap="replace"');

    fs.rmSync(dir, { recursive: true });
  });

  test("renames xh-loading to xh-indicator", () => {
    const dir = tmpDir();
    const file = path.join(dir, "test.html");
    fs.writeFileSync(file, '<div xh-get="/api" xh-loading="#spinner"></div>');

    run("--from=1 --to=2 " + file);

    const content = fs.readFileSync(file, "utf-8");
    expect(content).toContain("xh-indicator");
    expect(content).not.toContain("xh-loading");

    fs.rmSync(dir, { recursive: true });
  });

  test("--reverse undoes migration", () => {
    const dir = tmpDir();
    const file = path.join(dir, "test.html");
    fs.writeFileSync(file, '<input xh-model="name">');

    run("--from=1 --to=2 --reverse " + file);

    const content = fs.readFileSync(file, "utf-8");
    expect(content).toContain("xh-bind");
    expect(content).not.toContain("xh-model");

    fs.rmSync(dir, { recursive: true });
  });

  test("processes multiple files in a directory", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "a.html"), '<div xh-bind="x"></div>');
    fs.writeFileSync(path.join(dir, "b.html"), '<div xh-loading="#s"></div>');
    fs.writeFileSync(path.join(dir, "c.txt"), 'not html');

    const out = run("--from=1 --to=2 " + dir);
    expect(out).toContain("Files changed:  2");

    expect(fs.readFileSync(path.join(dir, "a.html"), "utf-8")).toContain("xh-model");
    expect(fs.readFileSync(path.join(dir, "b.html"), "utf-8")).toContain("xh-indicator");

    fs.rmSync(dir, { recursive: true });
  });

  test("unchanged files are not reported", () => {
    const dir = tmpDir();
    const file = path.join(dir, "clean.html");
    fs.writeFileSync(file, '<div xh-get="/api" xh-trigger="load"></div>');

    const out = run("--from=1 --to=2 " + file);
    expect(out).toContain("Files changed:  0");

    fs.rmSync(dir, { recursive: true });
  });

  test("applies multiple rules to same file", () => {
    const dir = tmpDir();
    const file = path.join(dir, "multi.html");
    fs.writeFileSync(file, '<div xh-bind="name" xh-loading="#s" xh-swap="replace"></div>');

    const out = run("--from=1 --to=2 " + file);

    const content = fs.readFileSync(file, "utf-8");
    expect(content).toContain("xh-model");
    expect(content).toContain("xh-indicator");
    expect(content).toContain('xh-swap="outerHTML"');
    expect(out).toContain("Total changes:  3");

    fs.rmSync(dir, { recursive: true });
  });

  test("summary shows correct counts", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "a.html"), '<div xh-bind="x"></div>');
    fs.writeFileSync(path.join(dir, "b.html"), '<div xh-get="/api"></div>');

    const out = run("--from=1 --to=2 " + dir);
    expect(out).toContain("Files scanned:  2");
    expect(out).toContain("Files changed:  1");
    expect(out).toContain("Total changes:  1");

    fs.rmSync(dir, { recursive: true });
  });
});
