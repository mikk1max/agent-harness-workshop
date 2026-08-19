// KRYTERIUM KROKU 4 — plik zamrożony, implementer go nie edytuje.
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const CLI = path.join(__dirname, "..", "cli.js");
const file = path.join(os.tmpdir(), `todo-step4-${process.pid}.json`);

function run(args) {
  return execFileSync("node", [CLI, ...args], { encoding: "utf8" });
}

try {
  if (fs.existsSync(file)) fs.unlinkSync(file);

  run(["add", "kupić mleko", "--file", file]);
  run(["add", "wynieść śmieci", "--file", file]);
  run(["add", "umyć okna", "--file", file]);

  run(["remove", "2", "--file", file]);
  const out = run(["list", "--file", file]);
  const lines = out.trim().split("\n");

  assert.strictEqual(lines.length, 2, "po remove powinny zostać dwa zadania");
  assert.strictEqual(lines[0], "1 [ ] kupić mleko");
  assert.strictEqual(lines[1], "3 [ ] umyć okna", "id nie są przenumerowywane po remove");

  let failed = false;
  try {
    run(["remove", "999", "--file", file]);
  } catch (e) {
    failed = true;
    assert.strictEqual(e.status, 1, "remove na nieistniejącym id powinno dać exit code 1");
  }
  assert.ok(failed, "remove na nieistniejącym id powinno zakończyć proces błędem, nie sukcesem");

  console.log("step4: OK");
  process.exitCode = 0;
} catch (err) {
  console.error("step4: FAILED —", err.message);
  process.exitCode = 1;
} finally {
  if (fs.existsSync(file)) fs.unlinkSync(file);
}
