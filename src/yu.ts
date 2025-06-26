#!/usr/bin/env node
import axios from 'axios';
import fetch from 'node-fetch';
import { URL } from 'url';
import * as cheerio from 'cheerio';

export type CrewGuardReport = {
  canCrew: 'allowed' | 'partial' | 'blocked';
  report: string[];
  legalRisk: string[];     // 法律风险提示
  socialRisk: string[];    // 社会伦理风险提示
  technicalRisk: string[]; // 技术风险提示
  suggestions: string[];   // 综合建议
};

const HEADERS = {
  'User-Agent': 'MyCrawler/1.0 (+http://example.com/bot)',
};

const API_PATHS = ['/api/', '/v1/', '/rest/', '/data/', '/feed/'];

async function fetchPage(url: string) {
  try {
    const response = await axios.get(url, {
      headers: HEADERS,
      timeout: 10000,
      maxRedirects: 5,
      validateStatus: () => true,
    });
    return response;
  } catch {
    return null;
  }
}

function detectJsChallenge(content: string): boolean {
  const lower = content.toLowerCase();
  return (
    lower.includes("cloudflare") ||
    lower.includes("js challenge") ||
    lower.includes("checking your browser") ||
    (content.includes("setTimeout") && content.includes("location.href")) ||
    /<script>[^<]+captcha/i.test(content)
  );
}

async function checkApiEndpoints(baseUrl: string): Promise<string[]> {
  const found: string[] = [];
  for (const path of API_PATHS) {
    const url = new URL(path, baseUrl).href;
    try {
      const response = await axios.get(url, {
        headers: HEADERS,
        timeout: 5000,
        validateStatus: () => true,
      });
      if ([200, 401, 403].includes(response.status)) {
        found.push(`⚠️ Potential API endpoint detected: ${url} (status ${response.status})`);
      }
    } catch {
      continue;
    }
  }
  return found;
}

async function parseRobotsTxt(baseUrl: string, userAgent = "*"): Promise<string[]> {
  const report: string[] = [];
  const robotsUrl = new URL('/robots.txt', baseUrl).href;

  try {
    const res = await fetch(robotsUrl, { headers: HEADERS, timeout: 5000 });
    if (res.status !== 200) {
      report.push("⚠️ Failed to access robots.txt");
      return report;
    }

    const text = await res.text();
    const lines = text.split(/\r?\n/);
    const rules: Record<string, { Allow: string[]; Disallow: string[] }> = {};
    let currentUserAgent: string | null = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const [key, ...rest] = trimmed.split(":");
      const value = rest.join(":").trim();

      switch (key.toLowerCase()) {
        case "user-agent":
          currentUserAgent = value;
          if (!rules[currentUserAgent]) {
            rules[currentUserAgent] = { Allow: [], Disallow: [] };
          }
          break;
        case "allow":
          if (currentUserAgent) rules[currentUserAgent].Allow.push(value);
          break;
        case "disallow":
          if (currentUserAgent) rules[currentUserAgent].Disallow.push(value);
          break;
      }
    }

    const selected = rules[userAgent] || rules["*"];
    if (selected) {
      report.push("✅ robots.txt file found and successfully parsed");
      if (selected.Disallow.length > 0) {
        report.push("❌ Disallowed paths:");
        selected.Disallow.forEach((d) => report.push(`   - ${d || '/'}`));
      } else {
        report.push("✅ No disallowed paths found");
      }
      if (selected.Allow.length > 0) {
        report.push("✅ Allowed paths:");
        selected.Allow.forEach((a) => report.push(`   - ${a}`));
      }
    } else {
      report.push("⚠️ No robots.txt rules found for this user-agent");
    }

    return report;
  } catch (err) {
    return [`❌ Failed to parse robots.txt: ${(err as Error).message}`];
  }
}

// HTML 相关检测
function detectMetaRobots(html: string): string[] {
  const $ = cheerio.load(html);
  const content = $('meta[name="robots"]').attr('content');
  if (content) {
    return [`⚠️ Found <meta name="robots">: "${content}"`];
  }
  return [];
}

function detectXRobotsTag(headers: any): string[] {
  const tag = headers['x-robots-tag'];
  if (tag) {
    return [`⚠️ Found X-Robots-Tag header: "${tag}"`];
  }
  return [];
}

function detectCopyrightTerms(html: string): string[] {
  const lower = html.toLowerCase();
  const matched = [];
  if (lower.includes('terms of service') || lower.includes('使用条款')) {
    matched.push("⚠️ 'Terms of Service' mention found");
  }
  if (lower.includes('copyright') || lower.includes('©') || lower.includes('版权所有')) {
    matched.push("⚠️ Copyright information found");
  }
  return matched;
}

function detectPrivacySensitiveContent(html: string): string[] {
  const lower = html.toLowerCase();
  const flags = [];

  if (lower.match(/\b\d{3,4}[- ]?\d{7,8}\b/)) {
    flags.push("🔒 Potential phone number pattern found");
  }
  if (lower.match(/[a-z0-9_.+-]+@[a-z0-9-]+\.[a-z]{2,}/)) {
    flags.push("🔒 Email address pattern found");
  }
  if (lower.match(/\b\d{15,18}\b/)) {
    flags.push("🔒 Potential ID number detected");
  }

  return flags;
}

// 新增风险评估函数
function evaluateLegalRisk(reportLines: string[]): string[] {
  const risks: string[] = [];
  if (reportLines.some(l => l.includes('Terms of Service') || l.includes('terms of use'))) {
    risks.push("⚠️ Legal: The site may explicitly prohibit crawling in its terms.");
  }
  if (reportLines.some(l => l.includes('copyright') || l.includes('版权所有') || l.includes('©'))) {
    risks.push("⚠️ Legal: Copyrighted content detected; scraping may lead to infringement.");
  }
  if (reportLines.some(l => l.includes('Email') || l.includes('phone number') || l.includes('ID number'))) {
    risks.push("⚠️ Legal: Sensitive personal data detected, scraping may violate privacy laws.");
  }
  return risks;
}

function evaluateSocialRisk(reportLines: string[]): string[] {
  const risks: string[] = [];
  if (reportLines.some(l => l.includes('Disallowed paths'))) {
    risks.push("⚠️ Social: Disallowed paths in robots.txt indicate site owner's crawling restrictions.");
  }
  if (reportLines.some(l => l.includes('Cloudflare') || l.includes('JavaScript challenge'))) {
    risks.push("⚠️ Social: Presence of anti-bot measures suggests site tries to protect user experience.");
  }
  if (reportLines.some(l => l.includes('phone number') || l.includes('email'))) {
    risks.push("⚠️ Social: Collecting personal info impacts user privacy and trust.");
  }
  return risks;
}

function evaluateTechnicalRisk(reportLines: string[]): string[] {
  const risks: string[] = [];
  if (reportLines.some(l => l.includes('Cloudflare protection detected') || l.includes('JavaScript challenge'))) {
    risks.push("⚠️ Technical: Advanced anti-bot protection may cause crawler failure.");
  }
  if (reportLines.some(l => l.includes('Failed to access robots.txt'))) {
    risks.push("⚠️ Technical: Unable to verify crawling rules, may increase risk.");
  }
  if (reportLines.some(l => l.includes('Redirect detected'))) {
    risks.push("⚠️ Technical: Redirects may cause crawler instability or unexpected target.");
  }
  return risks;
}

function generateSuggestions(legalRisks: string[], socialRisks: string[], technicalRisks: string[]): string[] {
  const sug: string[] = [];
  if (legalRisks.length > 0) {
    sug.push("📌 Suggestion: Consult legal counsel and avoid crawling prohibited or sensitive content.");
  } else {
    sug.push("📌 Suggestion: Review site terms regularly to ensure ongoing compliance.");
  }
  if (socialRisks.length > 0) {
    sug.push("📌 Suggestion: Control crawl rate, anonymize personal data, and respect user privacy.");
  } else {
    sug.push("📌 Suggestion: Maintain ethical standards and transparent data use.");
  }
  if (technicalRisks.length > 0) {
    sug.push("📌 Suggestion: Enhance crawler with JS rendering support and robust error handling.");
  } else {
    sug.push("📌 Suggestion: Monitor crawler health and update anti-bot bypass strategies.");
  }
  sug.push("📌 Suggestion: Always set appropriate User-Agent and obey robots.txt rules.");
  return sug;
}

export async function checkSite(url: string): Promise<CrewGuardReport> {
  const baseUrl = new URL(url).origin;
  const report: string[] = [`🔍 Site Check: ${baseUrl}`];
  let canCrewScore: 1 | 2 | 3 = 1;

  const response = await fetchPage(baseUrl);
  if (!response) {
    report.push("❌ Site unreachable");
    return { canCrew: 'blocked', report, legalRisk: [], socialRisk: [], technicalRisk: [], suggestions: [] };
  }

  report.push(`📶 Status Code: ${response.status}`);
  if (response.status === 200) {
    report.push("✅ Site is accessible");
  } else {
    report.push("⚠️ Abnormal status code");
    canCrewScore = 2;
  }

  if ((response.request?.res?.responseUrl || '') !== baseUrl) {
    report.push("⚠️ Redirect detected");
    canCrewScore = 2;
  }

  const serverHeader = (response.headers['server'] || '').toLowerCase();
  if (serverHeader.includes("cloudflare")) {
    report.push("⚠️ Cloudflare protection detected");
    canCrewScore = 2;
  }

  if (detectJsChallenge(response.data)) {
    report.push("⚠️ JavaScript challenge detected (browser emulation may be required)");
    canCrewScore = 3;
  }

  const html = typeof response.data === 'string' ? response.data : '';
  if (html) {
    report.push(...detectMetaRobots(html));
    report.push(...detectCopyrightTerms(html));
    report.push(...detectPrivacySensitiveContent(html));
  }
  report.push(...detectXRobotsTag(response.headers));

  const robotsReport = await parseRobotsTxt(baseUrl);
  report.push(...robotsReport);
  if (robotsReport.some(line =>
    line.toLowerCase().includes("disallow") ||
    line.toLowerCase().includes("unreachable") ||
    line.toLowerCase().includes("failed to parse")
  )) {
    canCrewScore = Math.max(canCrewScore, 2) as 1 | 2 | 3;
  }

  const apiFindings = await checkApiEndpoints(baseUrl);
  if (apiFindings.length > 0) {
    report.push(...apiFindings);
    canCrewScore = Math.max(canCrewScore, 2) as 1 | 2 | 3;
  } else {
    report.push("✅ No common API paths found");
  }

  // 多维度风险评估
  const legalRisk = evaluateLegalRisk(report);
  const socialRisk = evaluateSocialRisk(report);
  const technicalRisk = evaluateTechnicalRisk(report);
  const suggestions = generateSuggestions(legalRisk, socialRisk, technicalRisk);

  const scoreToStatus = (score: 1 | 2 | 3): 'allowed' | 'partial' | 'blocked' => {
    return score === 1 ? 'allowed' : score === 2 ? 'partial' : 'blocked';
  };

  return { canCrew: scoreToStatus(canCrewScore), report, legalRisk, socialRisk, technicalRisk, suggestions };
}

