// auto-git.js
const { execSync } = require("child_process");
const readline = require("readline");

// Funktion zum Git-Befehl ausführen
function run(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

// Eingabeaufforderung
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question("💬 Commit-Nachricht: ", (message) => {
  try {
    // 1. Dateien hinzufügen
    run("git add .");

    // 2. Commit mit eigener Nachricht
    run(`git commit -m "${message}"`);

    // 3. Push auf main
    run("git branch -M main");
    run("git push -u origin main");

    console.log("✅ Git Upload erfolgreich!");
  } catch (err) {
    console.error("❌ Fehler beim Git Upload:", err.message);
  } finally {
    rl.close();
  }
});
