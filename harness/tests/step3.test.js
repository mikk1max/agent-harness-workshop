// KRYTERIUM KROKU 3 — plik zamrożony, implementer go nie edytuje.
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const CLI = path.join(__dirname, "..", "cli.js");
const file = path.join(os.tmpdir(), `todo-step3-${process.pid}.json`);

function run(args) {
  return execFileSync("node", [CLI, ...args], { encoding: "utf8" });
}

try {
  if (fs.existsSync(file)) fs.unlinkSync(file);

  run(["add", "kupić mleko", "--file", file]);
  run(["add", "wynieść śmieci", "--file", file]);

  run(["done", "1", "--file", file]);
  const out = run(["list", "--file", file]);
  const lines = out.trim().split("\n");

  assert.strictEqual(lines[0], "1 [x] kupić mleko", `zadanie 1 powinno być oznaczone jako zrobione: ${JSON.stringify(lines[0])}`);
  assert.strictEqual(lines[1], "2 [ ] wynieść śmieci", "zadanie 2 nie powinno się zmienić");

  let failed = false;
  try {
    run(["done", "999", "--file", file]);
  } catch (e) {
    failed = true;
    assert.strictEqual(e.status, 1, "done na nieistniejącym id powinno dać exit code 1");
  }
  assert.ok(failed, "done na nieistniejącym id powinno zakończyć proces błędem, nie sukcesem");

  console.log("step3: OK");
  process.exitCode = 0;
} catch (err) {
  console.error("step3: FAILED —", err.message);
  process.exitCode = 1;
} finally {
  if (fs.existsSync(file)) fs.unlinkSync(file);
}
