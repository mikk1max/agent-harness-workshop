"use strict";
// Scout — deterministyczny kod, zero wywołań modelu.
// Scout robi DWIE rzeczy: (1) tworzy kolejny epizod, (2) czyta sygnały
// i decyduje, co dalej z planem. Harness tylko wykonuje te decyzje.
const fs = require("fs");
const path = require("path");

function readSignal(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

// Skanuje episodes/ i zwraca numer kolejnego (nieużytego) epizodu.
function nextEpisodeNumber(episodesDir) {
  const existing = fs
    .readdirSync(episodesDir)
    .filter((d) => /^episode-\d+$/.test(d))
    .map((d) => Number(d.split("-")[1]));
  return existing.length ? Math.max(...existing) + 1 : 1;
}

// Tworzy katalog kolejnego epizodu na dysku i zwraca jego numer.
// To scout jest właścicielem numeracji i istnienia katalogów epizodów —
// role tylko dopisują do nich swoje sygnały.
function startEpisode(episodesDir) {
  const episode = nextEpisodeNumber(episodesDir);
  fs.mkdirSync(path.join(episodesDir, `episode-${episode}`), { recursive: true });
  return episode;
}

// Decyduje, co zrobić dalej, na podstawie sygnałów jednego epizodu.
// Brak sygnału NIE jest werdyktem kroku — to osobny przypadek ("no-signal"),
// scout ma powtórzyć tę samą sesję z dopiskiem o braku pliku.
function decide({ implementer, releaseManager, detektyw }) {
  if (!implementer) return { action: "no-signal", agent: "implementer" };
  if (!releaseManager) return { action: "no-signal", agent: "release-manager" };
  if (!detektyw) return { action: "no-signal", agent: "detektyw" };

  if (!["advance", "retry", "walled"].includes(detektyw.status)) {
    throw new Error(`Nieznany status detektywa: ${detektyw.status}`);
  }
  return { action: detektyw.status };
}

function parseSteps(planText) {
  const re = /^- \[( |x)\] (\d+)\. (.+?) — `(.+?)`/gm;
  const steps = [];
  let m;
  while ((m = re.exec(planText))) {
    steps.push({ done: m[1] === "x", id: m[2], text: m[3].trim(), criterion: m[4].trim() });
  }
  return steps;
}

function nextStepId(planPath, currentStepId) {
  const steps = parseSteps(fs.readFileSync(planPath, "utf8"));
  const idx = steps.findIndex((s) => s.id === currentStepId);
  for (let i = idx + 1; i < steps.length; i++) {
    if (!steps[i].done) return steps[i].id;
  }
  return null;
}

function allStepsDone(planPath) {
  const steps = parseSteps(fs.readFileSync(planPath, "utf8"));
  return steps.every((s) => s.done);
}

function checkOffStep(planPath, stepId) {
  const text = fs.readFileSync(planPath, "utf8");
  const re = new RegExp(`^- \\[ \\] (${stepId})\\. `, "m");
  if (!re.test(text)) {
    throw new Error(`Krok ${stepId} nie istnieje albo jest już odhaczony w ${planPath}`);
  }
  fs.writeFileSync(planPath, text.replace(re, "- [x] $1. "));
}

function loadConfig(configPath) {
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

function saveConfig(configPath, config) {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
}

// Scout sam sobie koryguje konfigurację: jeśli krok wymagał powtórki,
// zakładamy że agentowi implementującemu zabrakło przestrzeni na próby
// i naprawy — podnosimy jego limit tur na następną rundę (z sufitem, żeby
// nie urosło bez końca). To jedyna forma "uczenia się" w tym harnessie —
// prosta, ale realna: config na dysku faktycznie się zmienia między epizodami.
const MAX_TURNS_CEILING = 40;
const MAX_TURNS_STEP = 5;

function tuneAfterRetry(configPath, role) {
  const config = loadConfig(configPath);
  const current = config.roles[role].maxTurns;
  const next = Math.min(current + MAX_TURNS_STEP, MAX_TURNS_CEILING);
  if (next === current) return { changed: false, maxTurns: current };
  config.roles[role].maxTurns = next;
  saveConfig(configPath, config);
  return { changed: true, maxTurns: next, previous: current };
}

// Jedyne miejsce, które łączy sygnały epizodu z ruchem w planie.
// Harness woła to raz na epizod i tylko wykonuje zwróconą decyzję
// (increment/exit) — samo "co dalej z krokiem" jest w całości tutaj.
function decideNextStep({ planPath, stepId, signals }) {
  const decision = decide(signals);

  if (decision.action !== "advance") {
    return { action: decision.action, stepId, done: false };
  }

  checkOffStep(planPath, stepId);
  const done = allStepsDone(planPath);
  const next = done ? null : nextStepId(planPath, stepId);
  return { action: "advance", stepId: next, done };
}

module.exports = {
  readSignal,
  decide,
  parseSteps,
  nextStepId,
  allStepsDone,
  checkOffStep,
  nextEpisodeNumber,
  startEpisode,
  decideNextStep,
  loadConfig,
  saveConfig,
  tuneAfterRetry,
};
