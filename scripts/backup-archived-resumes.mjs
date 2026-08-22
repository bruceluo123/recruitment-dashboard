#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { list } from '@vercel/blob';

const ROOT = process.cwd();
const DAY_MS = 24 * 60 * 60 * 1000;

function loadEnv() {
  const envPath = path.join(ROOT, '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function arg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function parseArray(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeBlobUrl(raw) {
  try {
    const url = new URL(String(raw || ''));
    if (!url.hostname.endsWith('.blob.vercel-storage.com')) return '';
    return `${url.origin}${url.pathname}`;
  } catch {
    return '';
  }
}

function collectBlobUrls(value, result = new Set()) {
  if (typeof value === 'string') {
    const normalized = normalizeBlobUrl(value);
    if (normalized) result.add(normalized);
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectBlobUrls(item, result));
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => collectBlobUrls(item, result));
  }
  return result;
}

function retentionDate(talent) {
  const time = new Date(talent.archivedAt || talent.updatedAt || talent.createdAt || '').getTime();
  return Number.isFinite(time) ? time : Date.now();
}

function safeName(value, fallback, maxLength = 90) {
  const normalized = String(value || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim();
  return (normalized || fallback).slice(0, maxLength).replace(/[. ]+$/, '') || fallback;
}

function csvCell(value) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

async function kvGet(key) {
  const response = await fetch(`${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
  });
  if (!response.ok) throw new Error(`KV 读取失败：${response.status}`);
  return (await response.json()).result;
}

async function allBlobs() {
  const blobs = [];
  let cursor;
  do {
    const page = await list({ limit: 1000, cursor });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return blobs;
}

async function downloadWithRetry(url, outputPath, expectedSize) {
  try {
    const stat = await fsp.stat(outputPath);
    if (!expectedSize || stat.size === expectedSize) return { skipped: true, size: stat.size };
  } catch {
    // File does not exist yet.
  }

  const partPath = `${outputPath}.part`;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (expectedSize && buffer.length !== expectedSize) {
        throw new Error(`文件大小不一致：${buffer.length}/${expectedSize}`);
      }
      await fsp.writeFile(partPath, buffer);
      await fsp.rename(partPath, outputPath);
      return { skipped: false, size: buffer.length };
    } catch (error) {
      await fsp.rm(partPath, { force: true }).catch(() => {});
      if (attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1200));
    }
  }
  throw new Error('下载失败');
}

async function fileSha256(filePath) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

async function main() {
  loadEnv();
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) throw new Error('缺少 KV 环境配置');
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('缺少 BLOB_READ_WRITE_TOKEN');

  const days = Number(arg('--days', '30'));
  const today = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const outputDir = path.resolve(arg('--output', `D:\\企鹅岛简历库\\归档备份-${today}`));
  const filesDir = path.join(outputDir, '简历文件');
  await fsp.mkdir(filesDir, { recursive: true });

  const [talentValue, repushValue, candidateValue, blobs] = await Promise.all([
    kvGet('recruit:talents'),
    kvGet('recruit:repush'),
    kvGet('recruit:candidates'),
    allBlobs(),
  ]);
  const talents = parseArray(talentValue);
  const repush = parseArray(repushValue);
  const candidates = parseArray(candidateValue);
  const cutoff = Date.now() - days * DAY_MS;
  const eligible = talents.filter((talent) => talent.archived === true && talent.resumeUrl && retentionDate(talent) <= cutoff);
  const eligibleIds = new Set(eligible.map((talent) => talent.id));
  const protectedUrls = collectBlobUrls([repush, candidates]);
  talents.forEach((talent) => {
    if (!eligibleIds.has(talent.id) && talent.resumeUrl) {
      const normalized = normalizeBlobUrl(talent.resumeUrl);
      if (normalized) protectedUrls.add(normalized);
    }
  });

  const blobMap = new Map();
  blobs.forEach((blob) => {
    const entry = { url: blob.url, downloadUrl: blob.downloadUrl || blob.url, size: blob.size };
    [blob.url, blob.downloadUrl].filter(Boolean).forEach((url) => {
      const normalized = normalizeBlobUrl(url);
      if (normalized) blobMap.set(normalized, entry);
    });
  });

  const planned = eligible
    .map((talent) => ({ talent, normalizedUrl: normalizeBlobUrl(talent.resumeUrl), blob: blobMap.get(normalizeBlobUrl(talent.resumeUrl)) }))
    .filter((item) => item.normalizedUrl && item.blob && !protectedUrls.has(item.normalizedUrl));

  process.stdout.write(`准备备份 ${planned.length} 份原始简历到 ${outputDir}\n`);
  const manifest = [];
  let cursor = 0;
  let completed = 0;
  let totalBytes = 0;
  const failures = [];

  const worker = async () => {
    while (cursor < planned.length) {
      const item = planned[cursor];
      cursor += 1;
      const { talent, blob } = item;
      const folderName = safeName(`${talent.candidateCode || talent.id} - ${talent.name || '未命名'}`, safeName(talent.id, '未命名'));
      const folderPath = path.join(filesDir, folderName);
      await fsp.mkdir(folderPath, { recursive: true });
      const urlPath = new URL(blob.url).pathname;
      const urlFileName = decodeURIComponent(urlPath.slice(urlPath.lastIndexOf('/') + 1));
      const fileName = safeName(talent.resumeFileName || urlFileName, 'resume.pdf', 130);
      const outputPath = path.join(folderPath, fileName);
      try {
        const result = await downloadWithRetry(blob.downloadUrl, outputPath, blob.size);
        const sha256 = await fileSha256(outputPath);
        totalBytes += result.size;
        manifest.push({
          id: talent.id,
          candidateCode: talent.candidateCode || '',
          name: talent.name || '',
          jobTitle: talent.jobTitle || '',
          archivedAt: talent.archivedAt || '',
          sourceFileName: talent.resumeFileName || urlFileName,
          backupRelativePath: path.relative(outputDir, outputPath),
          sourceUrl: talent.resumeUrl,
          size: result.size,
          sha256,
          backedUpAt: new Date().toISOString(),
        });
      } catch (error) {
        failures.push({ id: talent.id, name: talent.name || '', url: talent.resumeUrl, error: error.message });
      }
      completed += 1;
      if (completed % 25 === 0 || completed === planned.length) {
        process.stdout.write(`进度 ${completed}/${planned.length}，成功 ${manifest.length}，失败 ${failures.length}\n`);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(4, planned.length || 1) }, () => worker()));
  manifest.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  const headers = ['id', 'candidateCode', 'name', 'jobTitle', 'archivedAt', 'sourceFileName', 'backupRelativePath', 'sourceUrl', 'size', 'sha256', 'backedUpAt'];
  const csv = [headers.map(csvCell).join(','), ...manifest.map((row) => headers.map((key) => csvCell(row[key])).join(','))].join('\r\n');
  await fsp.writeFile(path.join(outputDir, '备份清单.csv'), `\uFEFF${csv}`, 'utf8');
  await fsp.writeFile(path.join(outputDir, '备份清单.json'), JSON.stringify({ days, createdAt: new Date().toISOString(), count: manifest.length, totalBytes, records: manifest, failures }, null, 2), 'utf8');

  process.stdout.write(`备份完成：${manifest.length}/${planned.length} 份，共 ${(totalBytes / 1024 / 1024).toFixed(1)} MB\n`);
  if (failures.length) {
    process.stdout.write(`有 ${failures.length} 份失败，详情见备份清单.json\n`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
