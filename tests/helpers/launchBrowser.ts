import puppeteer from 'puppeteer-core';
import { execSync } from 'child_process';
import os from 'os';

export default async function launchBrowser() {
  const executablePath = findChromeExecutable();
  const browser = await puppeteer.launch({
    headless: true, // Adjust based on your Puppeteer version
    executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  console.log('Browser launched successfully.');
  return browser;
}

function findChromeExecutable() {
  const platform = os.platform();

  const chromePaths: Record<string, string[] | undefined> = {
    win32: [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
    ],
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'
    ],
    linux: [
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium'
    ]
  };

  const paths = chromePaths[platform] || [];
  for (const path of paths) {
    try {
      execSync(`test -x "${path}"`);
      return path;
    } catch (e) {
      continue; // Path doesn't exist or isn't executable
    }
  }

  throw new Error('Chrome executable not found. Please install Chrome or Chromium.');
}
