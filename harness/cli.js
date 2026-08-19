"use strict";
const fs = require("fs");
const path = require("path");

// Parse args
const args = process.argv.slice(2);
const command = args[0];

// Find --file flag
const fileIndex = args.indexOf("--file");
if (fileIndex === -1 || !args[fileIndex + 1]) {
  process.stderr.write("Brak parametru --file\n");
  process.exit(1);
}
const filePath = args[fileIndex + 1];

// Read tasks from file
function readTasks() {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, "utf8");
  return JSON.parse(content);
}

// Write tasks to file
function writeTasks(tasks) {
  fs.writeFileSync(filePath, JSON.stringify(tasks, null, 2), "utf8");
}

// Get next id (max id + 1, or 1 if empty)
function nextId(tasks) {
  if (tasks.length === 0) return 1;
  return Math.max(...tasks.map(t => t.id)) + 1;
}

switch (command) {
  case "add": {
    const text = args[1];
    if (!text) {
      process.stderr.write("Brak tekstu zadania\n");
      process.exit(1);
    }
    const tasks = readTasks();
    const id = nextId(tasks);
    tasks.push({ id, text, done: false });
    writeTasks(tasks);
    break;
  }

  case "list": {
    const tasks = readTasks();
    const sorted = tasks.slice().sort((a, b) => a.id - b.id);
    for (const task of sorted) {
      const mark = task.done ? "x" : " ";
      process.stdout.write(`${task.id} [${mark}] ${task.text}\n`);
    }
    break;
  }

  case "done": {
    const id = parseInt(args[1], 10);
    const tasks = readTasks();
    const task = tasks.find(t => t.id === id);
    if (!task) {
      process.stderr.write(`Nie znaleziono zadania o id ${id}\n`);
      process.exit(1);
    }
    task.done = true;
    writeTasks(tasks);
    break;
  }

  case "remove": {
    const id = parseInt(args[1], 10);
    const tasks = readTasks();
    const index = tasks.findIndex(t => t.id === id);
    if (index === -1) {
      process.stderr.write(`Nie znaleziono zadania o id ${id}\n`);
      process.exit(1);
    }
    tasks.splice(index, 1);
    writeTasks(tasks);
    break;
  }

  case "count": {
    const tasks = readTasks();
    process.stdout.write(`${tasks.length}\n`);
    break;
  }

  default: {
    process.stderr.write(`Nieznana komenda: ${command}\n`);
    process.exit(1);
  }
}
