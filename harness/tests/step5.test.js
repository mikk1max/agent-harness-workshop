// KRYTERIUM KROKU 5 — plik zamrożony, implementer go nie edytuje.
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const CLI = path.join(__dirname, "..", "cli.js");
const file = path.join(os.tmpdir(), `todo-step5-${process.pid}.json`);

function run(args) {
  return execFileSync("node", [CLI, ...args], { encoding: "utf8" });
}

try {
  if (fs.existsSync(file)) fs.unlinkSync(file);

  const zero = run(["count", "--file", file]).trim();
  assert.strictEqual(zero, "0", `pusty/nieistniejący plik powinien dać count 0: ${JSON.stringify(zero)}`);

  run(["add", "kupić mleko", "--file", file]);
  run(["add", "wynieść śmieci", "--file", file]);
  run(["add", "umyć okna", "--file", file]);
  run(["done", "1", "--file", file]);

  const three = run(["count", "--file", file]).trim();
  assert.strictEqual(three, "3", `count powinien liczyć wszystkie zadania niezależnie od done: ${JSON.stringify(three)}`);

  run(["remove", "2", "--file", file]);
  const two = run(["count", "--file", file]).trim();
  assert.strictEqual(two, "2", `count po remove powinien spaść do 2: ${JSON.stringify(two)}`);

  console.log("step5: OK");
  process.exitCode = 0;
} catch (err) {
  console.error("step5: FAILED —", err.message);
  process.exitCode = 1;
} finally {
  if (fs.existsSync(file)) fs.unlinkSync(file);
}
