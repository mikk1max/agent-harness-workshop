"use strict";
// Pętla epizodów: scout tworzy epizod -> (implementer -> release manager ->
// detektyw) -> scout czyta sygnały i decyduje co dalej -> kolejny epizod.
// Harness NIE podejmuje żadnej decyzji sam — tylko wykonuje to, co zwróci scout.
// Ustawienia (limit epizodów, limit powtórek, model/effort/max-turns per rola)
// mieszkają w scout-config.json i są czytane na nowo w każdej iteracji, bo
// scout może je sam skorygować (patrz: tuneAfterRetry).
// node harness.js [--max-episodes N]
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const scout = require("./scout");

const HARNESS_DIR = __dirname;
const PLAN_PATH = path.join(HARNESS_DIR, "plan.md");
const EPISODES_DIR = path.join(HARNESS_DIR, "episodes");
const CONFIG_PATH = path.join(HARNESS_DIR, "scout-config.json");

const SIGNAL_FILE = {
  implementer: "implementer-signal.json",
  "release-manager": "release-manager-signal.json",
  detektyw: "detektyw-signal.json",
};

function argValue(flag, fallback) {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}
const MAX_EPISODES_OVERRIDE = argValue("--max-episodes", null);

function signalPath(episode, role) {
  return path.join(EPISODES_DIR, `episode-${episode}`, SIGNAL_FILE[role]);
}

const FATAL_API_ERROR_EXIT_CODE = 4; // patrz run-agent.js: isFatalApiError

// Odpala sesję jednej roli, powtarzając ją (bez zmiany numeru epizodu), jeśli
// nie zostawi pliku sygnału. Brak sygnału to nie werdykt kroku — to osobna
// awaria, po którą wraca ten sam agent z dopiskiem. Model/effort/max-turns
// dla roli bierze run-agent.js sam ze scout-config.json.
//
// Wyjątek: błąd API (limit konta, rate-limit) NIE jest "brakiem sygnału" do
// powtórki — kolejne próby i tak nic nie zmienią, dopóki limit trwa. Taki
// błąd przerywa cały harness od razu, bez zużywania limitu powtórek na darmo.
function runRoleWithRetries(role, episode, stepId, maxSignalRetries) {
  let note = null;
  for (let attempt = 1; attempt <= maxSignalRetries; attempt++) {
    const args = ["run-agent.js", role, String(episode), stepId];
    if (note) args.push("--note", note);
    const result = spawnSync("node", args, { cwd: HARNESS_DIR, stdio: "inherit" });

    if (result.status === FATAL_API_ERROR_EXIT_CODE) {
      return { ok: false, fatal: true };
    }
    if (fs.existsSync(signalPath(episode, role))) return { ok: true, fatal: false };

    console.warn(
      `\n[harness] brak sygnału ${role} (próba ${attempt}/${maxSignalRetries}) — powtarzam sesję.`
    );
    note = `Poprzednia próba (próba ${attempt}) NIE zostawiła pliku sygnału ${SIGNAL_FILE[role]}. Zapisanie tego pliku jako ostatnia czynność sesji jest obowiązkowe — zrób to teraz.`;
  }
  return { ok: false, fatal: false };
}

function stopOnRoleFailure(role, outcome) {
  if (outcome.ok) return;
  if (outcome.fatal) {
    console.error(
      `\n[harness] STOP: zewnętrzny błąd API przy sesji ${role} (limit konta/rate-limit). ` +
      `To nie problem z krokiem ani z harnessem — poczekaj na reset limitu albo zmień klucz/plan, potem odpal 'node harness.js' żeby wznowić.`
    );
    process.exit(7);
  }
  console.error(`[harness] STOP: ${role} nie zostawił sygnału mimo powtórek — to dziura w harnessie.`);
  process.exit(3);
}

function main() {
  fs.mkdirSync(EPISODES_DIR, { recursive: true });

  let steps = scout.parseSteps(fs.readFileSync(PLAN_PATH, "utf8"));
  let stepId = (steps.find((s) => !s.done) || {}).id;
  if (!stepId) {
    console.log("[harness] plan.md jest już w całości odhaczony. Nic do zrobienia.");
    process.exit(0);
  }

  for (;;) {
    // config czytany na nowo co epizod — scout mógł go zmienić po poprzednim retry
    const config = scout.loadConfig(CONFIG_PATH);
    const maxEpisodes = Number(MAX_EPISODES_OVERRIDE || config.maxEpisodes);
    const maxSignalRetries = config.maxSignalRetries;

    // bezpiecznik: sprawdzamy limit PRZED utworzeniem kolejnego epizodu,
    // żeby scout nie zostawił osieroconego, pustego katalogu nad limitem
    if (scout.nextEpisodeNumber(EPISODES_DIR) > maxEpisodes) {
      console.error(`\n[harness] Osiągnięto limit epizodów (${maxEpisodes}) — bezpiecznik. Zatrzymano.`);
      process.exit(5);
    }

    const episode = scout.startEpisode(EPISODES_DIR); // scout tworzy epizod
    console.log(`\n########## EPIZOD ${episode} — krok ${stepId} ##########`);

    stopOnRoleFailure("implementer", runRoleWithRetries("implementer", episode, stepId, maxSignalRetries));
    stopOnRoleFailure("release-manager", runRoleWithRetries("release-manager", episode, stepId, maxSignalRetries));
    stopOnRoleFailure("detektyw", runRoleWithRetries("detektyw", episode, stepId, maxSignalRetries));

    const detSignal = scout.readSignal(signalPath(episode, "detektyw"));
    // scout czyta sygnały i w całości decyduje, co dalej z planem
    const decision = scout.decideNextStep({
      planPath: PLAN_PATH,
      stepId,
      signals: {
        implementer: scout.readSignal(signalPath(episode, "implementer")),
        releaseManager: scout.readSignal(signalPath(episode, "release-manager")),
        detektyw: detSignal,
      },
    });

    console.log(`[harness] werdykt detektywa: ${decision.action} — ${detSignal.summary}`);

    if (decision.action === "advance") {
      if (decision.done) {
        console.log("\n[harness] Wszystkie kroki planu odhaczone. KONIEC.");
        process.exit(0);
      }
      stepId = decision.stepId;
    } else if (decision.action === "walled") {
      console.error(`\n[harness] WALLED na kroku ${stepId}: ${detSignal.summary}`);
      console.error("[harness] Harness stoi i czeka na decyzję człowieka.");
      process.exit(4);
    } else if (decision.action === "retry") {
      // scout sam koryguje swoją konfigurację: więcej tur dla implementera,
      // skoro krok wymagał powtórki
      const tuning = scout.tuneAfterRetry(CONFIG_PATH, "implementer");
      if (tuning.changed) {
        console.log(`[harness] scout podniósł max-turns implementera: ${tuning.previous} -> ${tuning.maxTurns}`);
      }
    } else {
      throw new Error(`Nieoczekiwana decyzja scouta: ${decision.action}`);
    }
    // retry: stepId zostaje ten sam, scout w następnej iteracji utworzy nowy epizod
  }
}

main();
