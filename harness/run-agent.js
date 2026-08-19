"use strict";
// node run-agent.js <role> <episode> <stepId> [--max-turns N] [--model M] [--effort E] [--note "..."]
// role: implementer | release-manager | detektyw
//
// Statyczna "osobowość" każdej roli mieszka w .claude/agents/<role>.md
// (prawdziwy subagent Claude Code, odpalany przez --agent). Ten skrypt
// dokłada tylko dynamiczne dane epizodu (numer, krok, kryterium, tropy
// detektywa) jako wiadomość użytkownika.
//
// Ustawienia (max-turns/model/effort) domyślnie biorą się z scout-config.json
// per rola; flagi CLI, jeśli podane, nadpisują config (przydatne do ręcznych
// testów pojedynczej sesji bez odpalania całego harnessu).
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const scout = require("./scout");

const HARNESS_DIR = __dirname;
const CONFIG_PATH = path.join(HARNESS_DIR, "scout-config.json");

function parseArgs(argv) {
  const [role, episode, stepId, ...rest] = argv;
  const flag = (name) => {
    const idx = rest.indexOf(name);
    return idx >= 0 ? rest[idx + 1] : null;
  };
  return {
    role,
    episode: Number(episode),
    stepId: String(stepId),
    maxTurns: flag("--max-turns"),
    model: flag("--model"),
    effort: flag("--effort"),
    note: flag("--note"),
  };
}

function findStep(stepId) {
  const plan = fs.readFileSync(path.join(HARNESS_DIR, "plan.md"), "utf8");
  const re = /^- \[( |x)\] (\d+)\. (.+?) — `(.+?)`/gm;
  let m;
  while ((m = re.exec(plan))) {
    const [, , id, text, criterion] = m;
    if (id === stepId) return { text: text.trim(), criterion: criterion.trim() };
  }
  return null;
}

function detectiveNotes(episode, stepId) {
  const prevFile = path.join(HARNESS_DIR, "episodes", `episode-${episode - 1}`, "detektyw-signal.json");
  if (episode <= 1 || !fs.existsSync(prevFile)) return "Brak (pierwszy epizod dla tego kroku).";
  const sig = JSON.parse(fs.readFileSync(prevFile, "utf8"));
  if (sig.step !== stepId || sig.status !== "retry") return "Brak (poprzedni epizod nie był powtórką tego kroku).";
  return `${sig.summary}\n` + (sig.details || []).map((d) => `- ${d}`).join("\n");
}

const agentNames = {
  implementer: "implementer",
  "release-manager": "release-manager",
  detektyw: "detektyw",
};

const signalFileNames = {
  implementer: "implementer-signal.json",
  "release-manager": "release-manager-signal.json",
  detektyw: "detektyw-signal.json",
};

// Bierze ustawienia roli z scout-config.json; flaga CLI (jeśli podana) wygrywa.
function resolveSettings(role, cliOverrides) {
  const fallback = { maxTurns: 20, model: null, effort: null };
  let fromConfig = fallback;
  if (fs.existsSync(CONFIG_PATH)) {
    const roleConfig = scout.loadConfig(CONFIG_PATH).roles[role];
    if (roleConfig) fromConfig = roleConfig;
  }
  return {
    maxTurns: cliOverrides.maxTurns || fromConfig.maxTurns || fallback.maxTurns,
    model: cliOverrides.model || fromConfig.model || null,
    effort: cliOverrides.effort || fromConfig.effort || null,
  };
}

// Krótka wiadomość z danymi TEGO epizodu — cała reszta (jak się zachować,
// gdzie zapisać sygnał, jakich plików nie ruszać) jest już w .claude/agents/<role>.md.
function buildTaskMessage(role, episode, stepId, step, note) {
  const lines = [
    `Numer epizodu: ${episode}`,
    `Id kroku: ${stepId}`,
    `Treść kroku: ${step.text}`,
    `Kryterium do uruchomienia: \`${step.criterion}\``,
  ];
  if (role === "implementer") {
    lines.push(`Tropy detektywa z poprzedniego epizodu (jeśli to powtórka):\n${detectiveNotes(episode, stepId)}`);
  }
  if (note) {
    lines.push(`Dodatkowa uwaga od scouta: ${note}`);
  }
  return lines.join("\n\n");
}

// Czysta funkcja — testowalna na zapisanym wcześniej surowym logu sesji,
// bez wywoływania czegokolwiek. `is_error` + `api_error_status` to sygnatura
// błędu API (limit konta, rate-limit, przeciążenie), niezależna od treści
// odpowiedzi (nie polegamy na dopasowywaniu tekstu "usage limit" itp.).
function isFatalApiError(parsed) {
  return !!(parsed && parsed.is_error === true && parsed.api_error_status);
}

function main() {
  const { role, episode, stepId, note, ...cliOverrides } = parseArgs(process.argv.slice(2));
  if (!agentNames[role]) {
    console.error(`Nieznana rola: ${role}. Dozwolone: ${Object.keys(agentNames).join(", ")}`);
    process.exit(1);
  }
  const step = findStep(stepId);
  if (!step) {
    console.error(`Nie znaleziono kroku ${stepId} w plan.md`);
    process.exit(1);
  }
  const settings = resolveSettings(role, cliOverrides);
  const task = buildTaskMessage(role, episode, stepId, step, note);

  const episodeDir = path.join(HARNESS_DIR, "episodes", `episode-${episode}`);
  if (!fs.existsSync(episodeDir)) {
    console.error(
      `Katalog epizodu ${episodeDir} nie istnieje. Epizody tworzy scout ` +
      `(scout.startEpisode) — odpal przez harness.js, albo do testu ręcznego ` +
      `utwórz go sam: node -e "require('./scout').startEpisode('${path.join(HARNESS_DIR, "episodes")}')"`
    );
    process.exit(1);
  }

  console.log(
    `\n=== epizod ${episode} | agent: ${agentNames[role]} | krok: ${stepId} ` +
    `| model: ${settings.model || "domyślny"} | effort: ${settings.effort || "domyślny"} ` +
    `| max-turns: ${settings.maxTurns} ===\n`
  );

  const claudeArgs = [
    "-p", task,
    "--agent", agentNames[role],
    "--max-turns", String(settings.maxTurns),
    "--allowedTools", "Read Write Edit Bash(node *)",
    "--output-format", "json",
  ];
  if (settings.model) claudeArgs.push("--model", settings.model);
  if (settings.effort) claudeArgs.push("--effort", settings.effort);

  // output-format json => jedna sesja, jeden wynik na koniec (nie strumień na
  // żywo). Łapiemy stdout, żeby zapisać surowy JSON jako log epizodu.
  const result = spawnSync("claude", claudeArgs, {
    cwd: HARNESS_DIR,
    encoding: "utf8",
  });

  if (result.stderr) process.stderr.write(result.stderr);

  const sessionLogPath = path.join(episodeDir, `${role}-session.json`);
  let parsed = null;
  try {
    parsed = JSON.parse(result.stdout);
    fs.writeFileSync(sessionLogPath, JSON.stringify(parsed, null, 2) + "\n");
  } catch {
    // sesja się wywaliła przed wypisaniem poprawnego JSON-a (np. crash CLI) —
    // zapisujemy surowy stdout, żeby nie zgubić śladu
    fs.writeFileSync(sessionLogPath, result.stdout || "");
  }

  if (parsed) {
    console.log(
      `[run-agent] sesja: ${parsed.num_turns} tur, ${parsed.duration_ms}ms, ` +
      `$${parsed.total_cost_usd?.toFixed(4)}, wynik: ${parsed.terminal_reason}`
    );
    console.log(`[run-agent] odpowiedź modelu: ${(parsed.result || "").slice(0, 300)}`);
  }
  console.log(`[run-agent] surowy log sesji: ${sessionLogPath}`);

  // Błąd na poziomie API (limit konta, rate-limit, przeciążenie) to NIE to samo
  // co "agent nie zapisał sygnału" — powtórka tej samej sesji nic tu nie da,
  // dopóki limit/awaria się nie skończy. Harness ma się zatrzymać, nie kręcić
  // w kółko za darmo (koszt sesji przy tym błędzie to $0 — i tak nic nie robi).
  if (isFatalApiError(parsed)) {
    console.error(
      `\n[run-agent] BŁĄD API (status ${parsed.api_error_status}): ${parsed.result}`
    );
    console.error("[run-agent] To zewnętrzny limit/awaria, nie problem z promptem — powtarzanie nic nie zmieni.");
    process.exit(4);
  }

  const signalPath = path.join(episodeDir, signalFileNames[role]);
  if (!fs.existsSync(signalPath)) {
    console.error(`\n[run-agent] BRAK sygnału: ${signalPath} nie powstał.`);
    process.exit(2);
  }

  console.log(`[run-agent] sygnał zapisany: ${signalPath}`);
  process.exit(0);
}

module.exports = { isFatalApiError };

if (require.main === module) main();
