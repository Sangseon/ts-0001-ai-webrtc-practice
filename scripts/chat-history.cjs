'use strict';

// No dependencies, network requests, transcript parsing, or model calls.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const warning = code => ({ systemMessage: `ChatHistory: ${code}. Recording skipped; development can continue. See docs/ChatHistory.md.` });

// Conservative heuristics, not a complete secret detector. Never return matched values.
function hasSensitiveText(text) {
  return [
    /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/,
    /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/,
    /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/,
    /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
    /\bBearer\s+[A-Za-z0-9._~+\/-]{8,}/i,
    /(?:password|passwd|pwd|api[_ -]?key|access[_ -]?token|client[_ -]?secret|secret[_ -]?key|비밀번호|패스워드|비밀\s*키)["']?\s*(?:=|:|는|은)\s*["']?[^\s"'`,;{}<>]{4,}/i,
  ].some(pattern => pattern.test(text));
}

function checkHistory(root = ROOT, staged = false) {
  try {
    let contents;
    if (staged) {
      const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 });
      const names = git(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMRT']).split('\0')
        .filter(name => /^ChatHistory\/.*\.md$/i.test(name));
      // Read the index, not the working copy: this checks exactly what would be committed.
      contents = names.map(name => git(['show', `:${name}`]));
    } else {
      const directory = path.join(root, 'ChatHistory');
      const read = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        if (entry.isSymbolicLink()) throw new Error('unsupported-symlink');
        const filename = path.join(dir, entry.name);
        return entry.isDirectory() ? read(filename) : /\.md$/i.test(entry.name) ? [fs.readFileSync(filename, 'utf8')] : [];
      });
      contents = fs.existsSync(directory) ? read(directory) : [];
    }
    return { checked: contents.length, suspicious: contents.filter(hasSensitiveText).length, failed: false };
  } catch {
    return { checked: 0, suspicious: 0, failed: true };
  }
}

function block(text) {
  const longest = Math.max(2, ...(text.match(/`+/g) || []).map(s => s.length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}text\n${text}\n${fence}`;
}

function capture(event, root = ROOT) {
  const stateDir = path.join(root, '.chat-history');
  if (fs.existsSync(path.join(stateDir, 'disabled'))) return {};
  const kind = event.hook_event_name;
  if (!['UserPromptSubmit', 'Stop', 'Manual'].includes(kind)) return {};
  // Do not capture another workspace when a command is reused accidentally.
  // Native resolution also expands Windows 8.3 aliases returned in some IDE/temp paths.
  const relative = path.relative(fs.realpathSync.native(root), fs.realpathSync.native(event.cwd));
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return {};
  if (typeof event.session_id !== 'string' || !event.session_id ||
      typeof event.turn_id !== 'string' || !event.turn_id) return warning('missing-session-or-turn-id');
  if (kind === 'UserPromptSubmit' && typeof event.prompt !== 'string') return warning('missing-prompt');
  if (kind === 'Manual' && (typeof event.prompt !== 'string' || typeof event.response !== 'string')) return warning('missing-manual-text');
  if (kind === 'Stop' && typeof event.last_assistant_message !== 'string') return warning('missing-final-message');
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const lock = path.join(stateDir, 'lock');
  try { fs.mkdirSync(lock); } catch (error) {
    if (error.code === 'EEXIST') return warning('recorder-busy-or-stale-lock');
    throw error;
  }
  try {
    const id = hash(JSON.stringify([event.session_id, event.turn_id]));
    const stateFile = path.join(stateDir, `${id}.json`);
    let state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { prompts: [] };
    if (state.completed) return {};
    const save = () => {
      const temp = path.join(stateDir, `${id}.${crypto.randomUUID()}.tmp`);
      fs.writeFileSync(temp, JSON.stringify(state), { flag: 'wx', mode: 0o600 });
      fs.renameSync(temp, stateFile);
    };
    if (state.blocked) return warning('sensitive-content-recording-withheld');
    const received = kind === 'UserPromptSubmit' ? [event.prompt]
      : kind === 'Manual' ? [event.prompt, event.response, event.task || ''] : [event.last_assistant_message];
    if ([...state.prompts, ...received].some(text => hasSensitiveText(text))) {
      // Keep only a marker, so subsequent Stop cannot archive a partially captured turn.
      state = { blocked: true };
      save();
      return warning('sensitive-content-recording-withheld');
    }
    if (kind === 'UserPromptSubmit') {
      // Identical submissions can be intentional: preserve every received event.
      state.prompts.push(event.prompt);
      save();
      return {};
    }
    if (kind === 'Manual') state.prompts = [event.prompt];
    if (!state.prompts.length) return warning('prompt-not-captured');
    const historyDir = path.join(root, 'ChatHistory');
    fs.mkdirSync(historyDir, { recursive: true, mode: 0o700 });
    const entries = fs.readdirSync(historyDir).filter(name => /^\d{4,}-.+\.md$/i.test(name));
    // Recover idempotently if a previous write succeeded before state was saved.
    const existing = entries.find(name => {
      const fd = fs.openSync(path.join(historyDir, name), 'r');
      try {
        const header = Buffer.alloc(160);
        const count = fs.readSync(fd, header, 0, header.length, 0);
        return header.subarray(0, count).toString('utf8').includes(`Capture ID: ${id}\n`);
      } finally { fs.closeSync(fd); }
    });
    if (existing) {
      state = { completed: existing }; save(); return {};
    }
    let number = Math.max(0, ...entries.map(name => Number(name.match(/^\d+/)[0]))) + 1;
    const task = kind === 'Manual' && typeof event.task === 'string'
      ? event.task.replace(/[^\p{L}\p{N}_-]/gu, '-').slice(0, 60) || 'manual'
      : 'codex-turn';
    const response = kind === 'Manual' ? event.response : event.last_assistant_message;
    const content = `<!-- Capture ID: ${id}\nSource: ${kind === 'Manual' ? 'manual-copy' : 'codex-hooks'}\nCaptured: ${new Date().toISOString()}\n-->\n\n` +
      '# ChatHistory\n\nText below is copied verbatim from the indicated source; wrapper newlines are not part of the source text.\n' +
      (kind === 'Manual'
        ? 'Manual copy: fidelity depends on the supplied text; not an automatic capture.\n'
        : 'Scope: UserPromptSubmit.prompt and Stop.last_assistant_message; no attachments, intermediate messages, or tool output.\n') +
      '\n## User Prompt\n\n' + state.prompts.map((prompt, i) =>
        (state.prompts.length > 1 ? `### Submission ${i + 1}\n\n` : '') + block(prompt)).join('\n\n') +
      `\n\n## Codex Response\n\n${block(response)}\n`;
    let filename;
    for (;;) {
      filename = `${String(number).padStart(4, '0')}-${task}.md`;
      try {
        fs.writeFileSync(path.join(historyDir, filename), content, { flag: 'wx', mode: 0o600 });
        break;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        number++;
      }
    }
    state = { completed: filename }; save();
    return {};
  } finally {
    fs.rmdirSync(lock);
  }
}

function safeCapture(event, root) {
  try { return capture(event, root); }
  catch { return warning('recording-failed'); } // Never print payloads or exception text containing secrets.
}

if (require.main === module) {
  if (['--check', '--check-staged'].includes(process.argv[2])) {
    const result = checkHistory(ROOT, process.argv[2] === '--check-staged');
    process.stdout.write(JSON.stringify(result) + '\n');
    process.exitCode = result.failed || result.suspicious ? 1 : 0;
  } else {
  try {
    let event;
    if (process.argv[2] === '--manual' && process.argv[3]) {
      event = { ...JSON.parse(fs.readFileSync(process.argv[3], 'utf8')), hook_event_name: 'Manual',
        cwd: ROOT, session_id: 'manual', turn_id: crypto.randomUUID() };
    } else {
      event = JSON.parse(fs.readFileSync(0, 'utf8'));
    }
    process.stdout.write(JSON.stringify(safeCapture(event)) + '\n');
  } catch {
    process.stdout.write(JSON.stringify(warning('invalid-input')) + '\n');
  }
  // Exit 0, with JSON suitable for Stop. Never request a model continuation.
  }
}

module.exports = { safeCapture, block, hasSensitiveText, checkHistory };
