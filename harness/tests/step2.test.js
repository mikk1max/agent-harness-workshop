// KRYTERIUM KROKU 2 — plik zamrożony, implementer go nie edytuje.
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const CLI = path.join(__dirname, "..", "cli.js");
const file = path.join(os.tmpdir(), `todo-step2-${process.pid}.json`);

function run(args) {
  return execFileSync("node", [CLI, ...args], { encoding: "utf8" });
}

try {
  if (fs.existsSync(file)) fs.unlinkSync(file);

  run(["add", "kupić mleko", "--file", file]);
  run(["add", "wynieść śmieci", "--file", file]);

  const out = run(["list", "--file", file]);
  const lines = out.trim().split("\n");

  assert.strictEqual(lines.length, 2, "list powinno wypisać jedną linię na zadanie");
  assert.strictEqual(lines[0], "1 [ ] kupić mleko", `zła linia 1: ${JSON.stringify(lines[0])}`);
  assert.strictEqual(lines[1], "2 [ ] wynieść śmieci", `zła linia 2: ${JSON.stringify(lines[1])}`);

  console.log("step2: OK");
  process.exitCode = 0;
} catch (err) {
  console.error("step2: FAILED —", err.message);
  process.exitCode = 1;
} finally {
  if (fs.existsSync(file)) fs.unlinkSync(file);
}
