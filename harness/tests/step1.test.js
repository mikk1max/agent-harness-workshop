// KRYTERIUM KROKU 1 — plik zamrożony, implementer go nie edytuje.
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const CLI = path.join(__dirname, "..", "cli.js");
const file = path.join(os.tmpdir(), `todo-step1-${process.pid}.json`);

function run(args) {
  return execFileSync("node", [CLI, ...args], { encoding: "utf8" });
}

try {
  if (fs.existsSync(file)) fs.unlinkSync(file);

  run(["add", "kupić mleko", "--file", file]);
  assert.ok(fs.existsSync(file), "add powinno utworzyć plik, jeśli nie istnieje");

  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.ok(Array.isArray(data), "plik powinien zawierać tablicę");
  assert.strictEqual(data.length, 1, "po jednym add powinno być jedno zadanie");
  assert.strictEqual(data[0].id, 1, "pierwsze id powinno być równe 1");
  assert.strictEqual(data[0].text, "kupić mleko");
  assert.strictEqual(data[0].done, false, "nowe zadanie nie jest zrobione");

  run(["add", "wynieść śmieci", "--file", file]);
  const data2 = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.strictEqual(data2.length, 2, "po dwóch add powinny być dwa zadania");
  assert.strictEqual(data2[1].id, 2, "drugie id powinno być równe 2");

  console.log("step1: OK");
  process.exitCode = 0;
} catch (err) {
  console.error("step1: FAILED —", err.message);
  process.exitCode = 1;
} finally {
  if (fs.existsSync(file)) fs.unlinkSync(file);
}
