"use strict";
// Test scouta na ręcznie napisanych sygnałach — zero wywołań modelu.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  decide,
  nextStepId,
  allStepsDone,
  checkOffStep,
  nextEpisodeNumber,
  startEpisode,
  decideNextStep,
  loadConfig,
  saveConfig,
  tuneAfterRetry,
} = require("./scout");

function tmpPlan(content) {
  const p = path.join(os.tmpdir(), `plan-${process.pid}-${Math.floor(Math.random() * 1e6)}.md`);
  fs.writeFileSync(p, content);
  return p;
}

function tmpEpisodesDir() {
  const d = path.join(os.tmpdir(), `episodes-${process.pid}-${Math.floor(Math.random() * 1e6)}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

const PLAN = `- [ ] 1. krok jeden — \`node tests/step1.test.js\`
- [ ] 2. krok dwa — \`node tests/step2.test.js\`
- [ ] 3. krok trzy — \`node tests/step3.test.js\`
`;

try {
  // brak sygnału implementera → no-signal, nie retry
  assert.deepStrictEqual(
    decide({ implementer: null, releaseManager: null, detektyw: null }),
    { action: "no-signal", agent: "implementer" }
  );

  // implementer jest, release managera brak → no-signal na release-managera
  assert.deepStrictEqual(
    decide({ implementer: { status: "done" }, releaseManager: null, detektyw: null }),
    { action: "no-signal", agent: "release-manager" }
  );

  // wszystkie trzy są, werdykt detektywa się liczy
  assert.deepStrictEqual(
    decide({
      implementer: { status: "done" },
      releaseManager: { status: "pass" },
      detektyw: { status: "advance" },
    }),
    { action: "advance" }
  );

  assert.deepStrictEqual(
    decide({
      implementer: { status: "done" },
      releaseManager: { status: "fail" },
      detektyw: { status: "retry" },
    }),
    { action: "retry" }
  );

  assert.deepStrictEqual(
    decide({
      implementer: { status: "done" },
      releaseManager: { status: "fail" },
      detektyw: { status: "walled" },
    }),
    { action: "walled" }
  );

  // nieznany status detektywa jest błędem, nie cichym przejściem dalej
  assert.throws(() =>
    decide({
      implementer: { status: "done" },
      releaseManager: { status: "pass" },
      detektyw: { status: "coś-nowego" },
    })
  );

  // checkOffStep i nextStepId na kopii planu
  let planPath = tmpPlan(PLAN);
  assert.strictEqual(allStepsDone(planPath), false);
  checkOffStep(planPath, "1");
  assert.strictEqual(fs.readFileSync(planPath, "utf8").includes("- [x] 1. krok jeden"), true);
  assert.strictEqual(nextStepId(planPath, "1"), "2");

  checkOffStep(planPath, "2");
  checkOffStep(planPath, "3");
  assert.strictEqual(allStepsDone(planPath), true);
  assert.strictEqual(nextStepId(planPath, "3"), null);

  // odhaczenie już odhaczonego kroku jest błędem, nie no-opem
  assert.throws(() => checkOffStep(planPath, "1"));

  fs.unlinkSync(planPath);

  // scout tworzy epizody: numeruje rosnąco i faktycznie zakłada katalog na dysku
  const episodesDir = tmpEpisodesDir();
  assert.strictEqual(nextEpisodeNumber(episodesDir), 1, "pusty episodes/ -> pierwszy epizod to 1");
  assert.strictEqual(startEpisode(episodesDir), 1);
  assert.ok(fs.existsSync(path.join(episodesDir, "episode-1")), "startEpisode musi realnie utworzyć katalog");
  assert.strictEqual(nextEpisodeNumber(episodesDir), 2, "po epizodzie 1 kolejny to 2");
  assert.strictEqual(startEpisode(episodesDir), 2);
  assert.strictEqual(startEpisode(episodesDir), 3, "numeracja rośnie, nawet gdy epizody są puste w środku");
  fs.rmSync(episodesDir, { recursive: true, force: true });

  // decideNextStep: scout w jednym miejscu łączy werdykt z ruchem w planie
  let planPath2 = tmpPlan(PLAN);
  const advanceResult = decideNextStep({
    planPath: planPath2,
    stepId: "1",
    signals: {
      implementer: { status: "done" },
      releaseManager: { status: "pass" },
      detektyw: { status: "advance" },
    },
  });
  assert.deepStrictEqual(advanceResult, { action: "advance", stepId: "2", done: false });
  assert.ok(fs.readFileSync(planPath2, "utf8").includes("- [x] 1. krok jeden"), "advance musi odhaczyć krok w plan.md");

  const retryResult = decideNextStep({
    planPath: planPath2,
    stepId: "2",
    signals: {
      implementer: { status: "done" },
      releaseManager: { status: "fail" },
      detektyw: { status: "retry" },
    },
  });
  assert.deepStrictEqual(retryResult, { action: "retry", stepId: "2", done: false });
  assert.ok(!fs.readFileSync(planPath2, "utf8").includes("- [x] 2. krok dwa"), "retry NIE może odhaczyć kroku");

  // advance na ostatnim nieodhaczonym kroku -> done: true, stepId: null
  decideNextStep({
    planPath: planPath2,
    stepId: "2",
    signals: {
      implementer: { status: "done" },
      releaseManager: { status: "pass" },
      detektyw: { status: "advance" },
    },
  });
  const finalResult = decideNextStep({
    planPath: planPath2,
    stepId: "3",
    signals: {
      implementer: { status: "done" },
      releaseManager: { status: "pass" },
      detektyw: { status: "advance" },
    },
  });
  assert.deepStrictEqual(finalResult, { action: "advance", stepId: null, done: true });

  // walled nie rusza planu
  let planPath3 = tmpPlan(PLAN);
  const walledResult = decideNextStep({
    planPath: planPath3,
    stepId: "1",
    signals: {
      implementer: { status: "done" },
      releaseManager: { status: "fail" },
      detektyw: { status: "walled" },
    },
  });
  assert.deepStrictEqual(walledResult, { action: "walled", stepId: "1", done: false });
  assert.ok(!fs.readFileSync(planPath3, "utf8").includes("- [x] 1."), "walled NIE może odhaczyć kroku");

  fs.unlinkSync(planPath2);
  fs.unlinkSync(planPath3);

  // tuneAfterRetry: scout sam podnosi maxTurns implementera po retry, z sufitem
  const configPath = path.join(os.tmpdir(), `scout-config-${process.pid}.json`);
  saveConfig(configPath, {
    maxEpisodes: 30,
    maxSignalRetries: 3,
    roles: { implementer: { maxTurns: 20, model: "sonnet", effort: "high" } },
  });
  let bump = tuneAfterRetry(configPath, "implementer");
  assert.deepStrictEqual(bump, { changed: true, maxTurns: 25, previous: 20 });
  assert.strictEqual(loadConfig(configPath).roles.implementer.maxTurns, 25, "zmiana musi wylądować na dysku");

  // sufit: powtarzane retry nie podbijają w nieskończoność
  for (let i = 0; i < 10; i++) tuneAfterRetry(configPath, "implementer");
  assert.strictEqual(loadConfig(configPath).roles.implementer.maxTurns, 40);
  assert.deepStrictEqual(tuneAfterRetry(configPath, "implementer"), { changed: false, maxTurns: 40 });

  fs.unlinkSync(configPath);
  console.log("scout.test: OK");
  process.exitCode = 0;
} catch (err) {
  console.error("scout.test: FAILED —", err.message);
  process.exitCode = 1;
}
