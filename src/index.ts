import * as fs from "fs";
import * as https from "https";
import * as path from "path";

// Minimal GitHub Actions toolkit — avoids bundling @actions/core et al.
// GitHub sets INPUT_<NAME> where NAME is uppercased with spaces replaced by _
// but hyphens are kept as-is (INPUT_API-KEY not INPUT_API_KEY)
function getInput(name: string): string {
  return (
    process.env[`INPUT_${name.toUpperCase()}`] ??
    process.env[`INPUT_${name.toUpperCase().replace(/-/g, "_")}`] ??
    ""
  );
}

function setOutput(name: string, value: string) {
  const file = process.env.GITHUB_OUTPUT;
  if (file) fs.appendFileSync(file, `${name}=${value}\n`);
}

function summary(text: string) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) fs.appendFileSync(file, text + "\n");
}

function log(msg: string) { console.log(msg); }
function warn(msg: string) { console.log(`::warning::${msg}`); }
function error(msg: string) { console.log(`::error::${msg}`); }

async function post(url: string, body: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: "POST",
      headers: { "Content-Length": Buffer.byteLength(body), ...headers },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function gradeEmoji(grade: string): string {
  return { A: "🟢", B: "🟢", C: "🟡", D: "🟠", F: "🔴" }[grade] ?? "⚪";
}

function scoreBar(score: number): string {
  const filled = Math.round(score / 10);
  return "█".repeat(filled) + "░".repeat(10 - filled);
}

function buildComment(result: Record<string, unknown>, specPath: string, failBelow: number | null): string {
  const score = result.score as number;
  const grade = result.grade as string;
  const meta = result.metadata as Record<string, unknown>;
  const categories = result.categories as Array<{ category: string; score: number }>;
  const findings = result.topFindings as string[];

  const passed = failBelow === null || score >= failBelow;
  const statusLine = failBelow !== null
    ? (passed ? `✅ Passed threshold (≥${failBelow})` : `❌ Failed threshold (≥${failBelow} required, got ${score})`)
    : "";

  const catRows = categories
    .map((c) => {
      const icon = c.score >= 75 ? "🟢" : c.score >= 50 ? "🟡" : "🔴";
      return `| ${c.category} | ${icon} ${c.score} |`;
    })
    .join("\n");

  const findingLines = findings.slice(0, 5).map((f) => `- ${f}`).join("\n");

  return [
    `## ${gradeEmoji(grade)} AgenticScore — ${score}/100 (${grade})`,
    "",
    `\`${scoreBar(score)}\` **${score}** · \`${specPath}\``,
    statusLine,
    "",
    `**${meta.specTitle ?? "Untitled"}** v${meta.specVersion ?? "?"} · ${meta.operationCount} operations · ${meta.schemaCount} schemas`,
    "",
    "| Category | Score |",
    "|---|---|",
    catRows,
    "",
    ...(findings.length > 0 ? ["**Top findings**", "", findingLines, ""] : []),
    `<sub>Scored by [AgenticScore](https://agenticscore.dev) · [Improve your score](https://agenticscore.dev/docs)</sub>`,
  ].join("\n");
}

async function postPrComment(comment: string): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const eventPath = process.env.GITHUB_EVENT_PATH;

  if (!token || !repo || !eventPath) {
    warn("GITHUB_TOKEN, GITHUB_REPOSITORY, or GITHUB_EVENT_PATH not set — skipping PR comment");
    return;
  }

  let prNumber: number | undefined;
  try {
    const event = JSON.parse(fs.readFileSync(eventPath, "utf-8"));
    prNumber = event.pull_request?.number ?? event.number;
  } catch {
    warn("Could not read PR number from event payload — skipping PR comment");
    return;
  }

  if (!prNumber) {
    log("Not a pull request event — skipping PR comment");
    return;
  }

  const url = `https://api.github.com/repos/${repo}/issues/${prNumber}/comments`;
  const { status } = await post(
    url,
    JSON.stringify({ body: comment }),
    {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      "User-Agent": "agenticscore-action",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  );

  if (status === 201) {
    log(`PR comment posted on #${prNumber}`);
  } else {
    warn(`Failed to post PR comment (HTTP ${status})`);
  }
}

async function run(): Promise<void> {
  const apiKey = getInput("api-key");
  const specPath = getInput("spec-path");
  const apiUrl = getInput("api-url") || "https://api.agenticscore.dev";
  const failBelowRaw = getInput("fail-below");
  const failBelow = failBelowRaw !== "" ? parseInt(failBelowRaw, 10) : null;

  if (!apiKey) { error("api-key is required"); process.exit(1); }
  if (!specPath) { error("spec-path is required"); process.exit(1); }

  const absPath = path.resolve(process.env.GITHUB_WORKSPACE ?? ".", specPath);
  if (!fs.existsSync(absPath)) { error(`Spec file not found: ${absPath}`); process.exit(1); }

  const specContent = fs.readFileSync(absPath, "utf-8");
  const isYaml = specPath.endsWith(".yaml") || specPath.endsWith(".yml");
  const contentType = isYaml ? "application/yaml" : "application/json";

  log(`Scoring ${specPath} (${specContent.length} bytes)…`);

  const { status, body } = await post(
    `${apiUrl}/score`,
    specContent,
    {
      "Content-Type": contentType,
      "x-api-key": apiKey,
    },
  );

  if (status === 401) { error("Invalid API key"); process.exit(1); }
  if (status === 402) { error("Monthly quota exceeded"); process.exit(1); }
  if (status === 422) { error(`Invalid OpenAPI spec: ${body}`); process.exit(1); }
  if (status !== 200) { error(`API error (HTTP ${status}): ${body}`); process.exit(1); }

  const result = JSON.parse(body) as Record<string, unknown>;
  const score = result.score as number;
  const grade = result.grade as string;

  log(`Score: ${score}/100 (${grade})`);

  setOutput("score", String(score));
  setOutput("grade", grade);

  const passed = failBelow === null || score >= failBelow;
  setOutput("passed", String(passed));

  const comment = buildComment(result, specPath, failBelow);

  summary(comment);
  await postPrComment(comment);

  if (!passed) {
    error(`Score ${score} is below required threshold of ${failBelow}`);
    process.exit(1);
  }
}

run().catch((err) => {
  error(err.message ?? String(err));
  process.exit(1);
});
