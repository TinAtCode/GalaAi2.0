// Attrappe für docker auf dem Windows-Test (ops/tests/windows-buero.test.ps1):
// Windows-Runner haben keine Linux-Container. Geprüft werden die Windows-
// Skripte selbst – welche docker-Befehle sie in welcher Reihenfolge aufrufen,
// mit welchen Pfaden (Umlaute, Leerzeichen). Die Attrappe
//  - schreibt jeden Aufruf als JSON-Zeile nach MOCK_DOCKER_LOG,
//  - erzeugt Zertifikate mit dem echten ops/demo/make-certs.sh (Git-Bash, openssl),
//  - startet bei "compose up" einen kleinen HTTPS-Server mit diesen Zertifikaten
//    (/api/setup/status, /api/health), bei "compose stop" hält sie ihn an,
//  - legt bei der Sofort-Sicherung einen Sicherungsordner an und prüft beim
//    Zurückspielen die Prüfsummen im eingebundenen Ordner wie sha256sum.
const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");

const args = process.argv.slice(2);

if (args[0] === "--serve") {
  const [, certDir, port] = args;
  const options = {
    key: fs.readFileSync(path.join(certDir, "server.key")),
    cert: fs.readFileSync(path.join(certDir, "server.crt")),
  };
  https
    .createServer(options, (req, res) => {
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/api/setup/status")
        res.end(JSON.stringify({ needed: !process.env.MOCK_SETUP_DONE }));
      else if (req.url === "/api/health") res.end('{"status":"ok"}');
      else res.end("{}");
    })
    .listen(Number(port));
  return;
}

const state = process.env.MOCK_DOCKER_STATE;
fs.appendFileSync(
  process.env.MOCK_DOCKER_LOG,
  `${JSON.stringify({ cwd: process.cwd(), args })}\n`,
);
const pidFile = path.join(state, "server.pid");

// Wert hinter einer Option (-f, --env-file, -v …); -v kann mehrfach vorkommen
const values = (name) =>
  args.flatMap((a, i) => (a === name ? [args[i + 1]] : []));
// -v "C:\Grün & Stein\x:/certs" → Pfad auf dem Rechner (Laufwerksbuchstabe beachten)
const hostPath = (target) => {
  const volume = values("-v").find((v) => v.includes(`:${target}`));
  return volume && volume.slice(0, volume.lastIndexOf(`:${target}`));
};
const envFile = () => {
  const file = values("--env-file")[0];
  const settings = {};
  for (const line of fs
    .readFileSync(file, "utf8")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line);
    if (m) settings[m[1]] = m[2];
  }
  return settings;
};
const stopServer = () => {
  if (!fs.existsSync(pidFile)) return;
  try {
    process.kill(Number(fs.readFileSync(pidFile, "utf8")));
  } catch {
    // schon beendet
  }
  fs.rmSync(pidFile);
};

if (args[0] === "info") process.exit(0);

if (args[0] === "run" && args.includes("/demo/make-certs.sh")) {
  const certs = hostPath("/certs");
  const demo = hostPath("/demo");
  const ips = args.slice(args.indexOf("/demo/make-certs.sh") + 1);
  const bash = "C:\\Program Files\\Git\\bin\\bash.exe";
  const result = spawnSync(
    bash,
    [path.join(demo, "make-certs.sh").replace(/\\/g, "/"), ...ips],
    {
      env: {
        ...process.env,
        CERT_DIR: certs.replace(/\\/g, "/"),
        CA_NAME: "GartenAI Buero CA",
        MSYS2_ARG_CONV_EXCL: "*",
        MSYS_NO_PATHCONV: "1",
      },
      stdio: "inherit",
    },
  );
  process.exit(result.status ?? 1);
}

if (args[0] === "compose") {
  const sub = args.find(
    (a, i) =>
      i > 0 &&
      !a.startsWith("-") &&
      !["-f", "--env-file", "--profile"].includes(args[i - 1]),
  );
  if (sub === "up" && !args.includes("postgres") && !args.includes("backend")) {
    stopServer();
    const certDir = path.join(process.cwd(), "ops", "buero", "certs");
    const server = spawn(
      process.execPath,
      [__filename, "--serve", certDir, envFile().HTTPS_PORT || "8443"],
      {
        detached: true,
        stdio: "ignore",
      },
    );
    fs.writeFileSync(pidFile, String(server.pid));
    server.unref();
    process.exit(0);
  }
  if (sub === "stop" && !args.includes("backend")) {
    stopServer();
    process.exit(0);
  }
  if (sub === "ps") {
    console.log("exited 0");
    process.exit(0);
  }
  if (sub === "exec" && args.includes("/auto-backup.sh")) {
    const stamp = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace("T", "-")
      .slice(0, 15);
    const dir = path.join(process.cwd(), "backups", "buero", stamp);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "gartenai.dump"), `dump ${stamp}`);
    fs.writeFileSync(path.join(dir, "uploads.tgz"), `uploads ${stamp}`);
    const sum = (f) =>
      crypto
        .createHash("sha256")
        .update(fs.readFileSync(path.join(dir, f)))
        .digest("hex");
    fs.writeFileSync(
      path.join(dir, "SHA256SUMS"),
      ["gartenai.dump", "uploads.tgz"]
        .map((f) => `${sum(f)}  ./${f}\n`)
        .join(""),
    );
    process.exit(0);
  }
  if (
    sub === "run" &&
    args.some((a) => a.includes("sha256sum --quiet -c SHA256SUMS"))
  ) {
    // wie sha256sum -c im Container: jede Zeile im eingebundenen Ordner prüfen
    const dir = hostPath("/restore:ro") ?? hostPath("/restore");
    for (const line of fs
      .readFileSync(path.join(dir, "SHA256SUMS"), "utf8")
      .trim()
      .split("\n")) {
      const [hash, file] = line.split(/\s+/);
      const actual = crypto
        .createHash("sha256")
        .update(fs.readFileSync(path.join(dir, file)))
        .digest("hex");
      if (actual !== hash) {
        console.error(`${file}: FAILED`);
        process.exit(1);
      }
    }
    process.exit(0);
  }
  // alles andere (pg_isready, pg_restore, stop/up backend …): gelingt
  process.exit(0);
}

console.error(`Attrappe: unbekannter Aufruf docker ${args.join(" ")}`);
process.exit(1);
