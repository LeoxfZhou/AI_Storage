#!/usr/bin/env node

import crypto from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const buildFile = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(buildFile), "..");
const sourceDir = path.join(projectRoot, "程序源码");
const runtimeRoot = path.join(projectRoot, "运行环境");
const configRoot = path.join(projectRoot, "发布配置");
const userDataTemplateDir = path.join(projectRoot, "用户数据模板");
const outputDir = path.join(projectRoot, "发布结果");
const stagingDir = path.join(outputDir, ".staging");
const require = createRequire(import.meta.url);
const JSZip = require(path.join(runtimeRoot, "Mac-x64", "node_modules", "jszip"));

const SOURCE_ITEMS = [
  "generate_report.mjs",
  "inspect_workbook.mjs",
  "prepare_data.mjs",
  "resolve_review.mjs",
  "package.json",
  "README.md",
  "src",
  "web",
];

const RELEASES = [
  {
    id: "mac",
    folderName: "记账程序-Mac版",
    configDir: path.join(configRoot, "Mac"),
    runtimeDir: path.join(runtimeRoot, "Mac-x64"),
    runtimeFileName: "node",
    launcherName: "启动记账程序.command",
  },
  {
    id: "windows",
    folderName: "记账程序-Windows版",
    configDir: path.join(configRoot, "Windows"),
    runtimeDir: path.join(runtimeRoot, "Windows-x64"),
    runtimeFileName: "node.exe",
    launcherName: "启动记账程序.bat",
  },
];

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function copyRequired(source, destination) {
  if (!(await pathExists(source))) {
    throw new Error(`缺少构建所需文件：${source}`);
  }
  await fs.cp(source, destination, { recursive: true, force: true });
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function verifyEmptyUserData(releaseRoot) {
  const progress = await readJson(path.join(releaseRoot, "用户数据", "异常处理进度.json"));
  const samples = await readJson(path.join(releaseRoot, "用户数据", "规则改进样本.json"));

  // 发布包只能带空模板。这里主动失败比误把真实人员和流水原文交给别人安全得多。
  if ((progress.entries ?? []).length > 0 || (samples.samples ?? []).length > 0) {
    throw new Error(`${path.basename(releaseRoot)} 的用户数据模板不是空白文件，已停止打包`);
  }
}

async function walkFiles(rootDir) {
  const files = [];
  const pending = [rootDir];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(fullPath);
      else if (entry.isFile()) files.push(fullPath);
    }
  }
  return files;
}

async function verifyReleaseContents(release, releaseRoot) {
  await verifyEmptyUserData(releaseRoot);
  const relativeFiles = (await walkFiles(releaseRoot)).map((filePath) => path.relative(releaseRoot, filePath));

  const forbiddenPatterns = [
    /(^|[/\\])runs([/\\]|$)/i,
    /review-state\.json$/i,
    /review-resolutions\.json$/i,
    /\.xlsx$/i,
  ];
  const forbiddenFile = relativeFiles.find((filePath) => forbiddenPatterns.some((pattern) => pattern.test(filePath)));
  if (forbiddenFile) {
    throw new Error(`${release.folderName} 意外包含用户或测试文件：${forbiddenFile}`);
  }

  const macNode = path.join(releaseRoot, "程序文件", ".runtime", "node");
  const windowsNode = path.join(releaseRoot, "程序文件", ".runtime", "node.exe");
  if (release.id === "mac" && (!(await pathExists(macNode)) || await pathExists(windowsNode))) {
    throw new Error("Mac 发布包的运行环境不纯净");
  }
  if (release.id === "windows" && (!(await pathExists(windowsNode)) || await pathExists(macNode))) {
    throw new Error("Windows 发布包的运行环境不纯净");
  }
}

async function buildRelease(release, version) {
  const releaseRoot = path.join(stagingDir, release.folderName);
  const programDir = path.join(releaseRoot, "程序文件");
  const runtimeDir = path.join(programDir, ".runtime");

  await fs.mkdir(runtimeDir, { recursive: true });
  await copyRequired(release.configDir, releaseRoot);
  await copyRequired(userDataTemplateDir, path.join(releaseRoot, "用户数据"));

  // 源码使用白名单复制，不把 tests、runs、软链接或开发脚本带给普通用户。
  // 这样用户拿到的包更小，也不会意外包含本机测试时上传过的工作簿。
  for (const itemName of SOURCE_ITEMS) {
    await copyRequired(path.join(sourceDir, itemName), path.join(programDir, itemName));
  }

  await copyRequired(
    path.join(release.runtimeDir, release.runtimeFileName),
    path.join(runtimeDir, release.runtimeFileName),
  );
  await copyRequired(
    path.join(release.runtimeDir, "node_modules"),
    path.join(programDir, "node_modules"),
  );

  const versionText = [
    "本地记账助手",
    `程序版本：${version}`,
    `发布平台：${release.id === "mac" ? "macOS Intel x64" : "Windows 10/11 x64"}`,
    "Node.js：24.19.0 LTS",
    `构建时间：${new Date().toISOString()}`,
    "用户数据格式：schemaVersion 1（Mac 与 Windows 兼容）",
    "",
  ].join("\n");
  await fs.writeFile(path.join(releaseRoot, "版本信息.txt"), versionText, "utf8");

  if (release.id === "mac") {
    await fs.chmod(path.join(releaseRoot, release.launcherName), 0o755);
    await fs.chmod(path.join(runtimeDir, release.runtimeFileName), 0o755);
  }

  await verifyReleaseContents(release, releaseRoot);
  return releaseRoot;
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? projectRoot,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status !== 0) {
    throw new Error(`${command} 执行失败：${result.stderr || result.stdout || `退出码 ${result.status}`}`);
  }
}

async function zipRelease(release, releaseRoot) {
  const zipPath = path.join(outputDir, `${release.folderName}.zip`);
  await fs.rm(zipPath, { force: true });

  if (release.id === "mac") {
    // ditto 会保留 .command 的可执行权限，用户解压后可以直接双击。
    runCommand("/usr/bin/ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", releaseRoot, zipPath]);
  } else {
    // macOS 自带的旧版 zip 不会给中文文件名写 UTF-8 标志，Windows 解压后可能乱码。
    // JSZip 会明确使用 UTF-8，并且只加入普通文件，不会产生 __MACOSX 或 ._ 文件。
    const archive = new JSZip();
    for (const filePath of await walkFiles(releaseRoot)) {
      const relativePath = path.relative(releaseRoot, filePath).split(path.sep).join("/");
      const stat = await fs.stat(filePath);
      archive.file(`${release.folderName}/${relativePath}`, createReadStream(filePath), {
        binary: true,
        date: stat.mtime,
        unixPermissions: stat.mode,
        createFolders: true,
      });
    }
    const outputStream = archive.generateNodeStream({
      type: "nodebuffer",
      platform: "UNIX",
      streamFiles: true,
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });
    await pipeline(outputStream, createWriteStream(zipPath));
  }
  return zipPath;
}

async function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(await fs.readFile(filePath));
  return hash.digest("hex");
}

async function main() {
  const packageJson = await readJson(path.join(sourceDir, "package.json"));
  await fs.mkdir(outputDir, { recursive: true });

  // 只清理构建脚本自己管理的临时目录，不碰“用户数据”和历史发布 ZIP。
  await fs.rm(stagingDir, { recursive: true, force: true });
  await fs.mkdir(stagingDir, { recursive: true });

  const outputs = [];
  try {
    for (const release of RELEASES) {
      console.log(`正在构建 ${release.folderName}…`);
      const releaseRoot = await buildRelease(release, packageJson.version);
      const zipPath = await zipRelease(release, releaseRoot);
      const stat = await fs.stat(zipPath);
      outputs.push({
        fileName: path.basename(zipPath),
        bytes: stat.size,
        sha256: await sha256(zipPath),
      });
    }
  } finally {
    // ZIP 已生成后删除重复的暂存副本，避免发布目录长期占用三份空间。
    await fs.rm(stagingDir, { recursive: true, force: true });
  }

  const manifestLines = [
    `本地记账助手 ${packageJson.version} 发布校验信息`,
    `生成时间：${new Date().toISOString()}`,
    "",
    ...outputs.flatMap((item) => [
      item.fileName,
      `  大小：${(item.bytes / 1024 / 1024).toFixed(1)} MB`,
      `  SHA-256：${item.sha256}`,
      "",
    ]),
  ];
  await fs.writeFile(path.join(outputDir, "发布校验信息.txt"), manifestLines.join("\n"), "utf8");
  console.log("\n构建完成：");
  for (const item of outputs) console.log(`- ${item.fileName}（${(item.bytes / 1024 / 1024).toFixed(1)} MB）`);
}

await main();
