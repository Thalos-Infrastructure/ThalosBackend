import fs from "fs";

const auth = JSON.parse(fs.readFileSync(process.env.HOME + "/.local/share/com.vercel.cli/auth.json", "utf8"));
const VT = auth.token;
const H = { Authorization: "Bearer " + VT };

const teams = await (await fetch("https://api.vercel.com/v2/teams?slug=manueljgs-projects", { headers: H })).json();
const teamId = teams?.teams?.[0]?.id || teams?.id;
console.log("teamId:", teamId);

const proj = await (await fetch(`https://api.vercel.com/v9/projects/thalosbackend?teamId=${teamId}`, { headers: H })).json();
console.log("productionBranch:", proj?.link?.productionBranch ?? "(default = repo default branch)");
console.log("git repo:", proj?.link ? `${proj.link.org}/${proj.link.repo}` : "(none)");
console.log("link type:", proj?.link?.type);
console.log("ssoProtection (preview auth):", JSON.stringify(proj?.ssoProtection));

const deps = await (await fetch(`https://api.vercel.com/v6/deployments?projectId=${proj.id}&teamId=${teamId}&limit=8`, { headers: H })).json();
console.log("\nrecent deployments:");
for (const d of deps.deployments || []) {
  const branch = d.meta?.githubCommitRef || d.meta?.branch || "?";
  const age = Math.round((Date.now() - d.created) / 60000);
  console.log(`  target=${d.target || "preview"}  ${d.readyState}  branch=${branch}  ${age}m  ${d.url}`);
}
