'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { safeCapture, hasSensitiveText, checkHistory } = require('./chat-history.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-history-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'ChatHistory'));
  fs.writeFileSync(path.join(root, 'ChatHistory', '0001-create-agents.md'), 'KEEP EXACTLY\r\n');
  const event = (hook_event_name, extra = {}) => ({ hook_event_name, cwd: root,
    session_id: 'test-session', turn_id: 'turn-1', ...extra });
  const run = (name, extra) => safeCapture(event(name, extra), root);
  const files = () => fs.readdirSync(path.join(root, 'ChatHistory')).sort();
  const read = name => fs.readFileSync(path.join(root, 'ChatHistory', name), 'utf8');
  return { root, event, run, files, read };
}

test('preserves Korean, spaces, CRLF, code fences and final response; continues numbering', t => {
  const f = fixture(t);
  const prompt = '  한글 원문\r\n```md\r\n## Codex Response\r\n```\r\n';
  const response = '\n최종 응답 😀\n````\n  ';
  assert.deepEqual(f.run('UserPromptSubmit', { prompt }), {});
  assert.equal(f.files().length, 1);
  assert.deepEqual(f.run('Stop', { last_assistant_message: response }), {});
  const saved = f.read('0002-codex-turn.md');
  assert.ok(saved.includes(`\n${prompt}\n`));
  assert.ok(saved.includes(`\n${response}\n`));
  assert.ok(saved.includes('`````text'));
  assert.equal(f.read('0001-create-agents.md'), 'KEEP EXACTLY\r\n');
  f.run('UserPromptSubmit', { turn_id: 'turn-2', prompt: 'next' });
  f.run('Stop', { turn_id: 'turn-2', last_assistant_message: 'done' });
  assert.ok(f.files().includes('0003-codex-turn.md'));
});

test('duplicate Stop is idempotent and does not change archived text', t => {
  const f = fixture(t);
  f.run('UserPromptSubmit', { prompt: 'original' });
  f.run('Stop', { last_assistant_message: 'original answer' });
  const before = f.read('0002-codex-turn.md');
  f.run('Stop', { last_assistant_message: 'different' });
  assert.equal(f.files().length, 2);
  assert.equal(f.read('0002-codex-turn.md'), before);
});

test('preserves every same-turn submission including identical prompts', t => {
  const f = fixture(t);
  f.run('UserPromptSubmit', { prompt: 'repeat' });
  f.run('UserPromptSubmit', { prompt: 'repeat' });
  f.run('Stop', { last_assistant_message: 'answer' });
  const saved = f.read('0002-codex-turn.md');
  assert.ok(saved.includes('### Submission 2'));
  assert.equal(saved.match(/\nrepeat\n/g).length, 2);
});

test('concurrent sessions are paired by session and turn, not latest prompt', t => {
  const f = fixture(t);
  f.run('UserPromptSubmit', { prompt: 'one' });
  f.run('UserPromptSubmit', { session_id: 'other', prompt: 'two' });
  f.run('Stop', { session_id: 'other', last_assistant_message: 'answer two' });
  f.run('Stop', { last_assistant_message: 'answer one' });
  assert.ok(f.read('0002-codex-turn.md').includes('\ntwo\n'));
  assert.ok(f.read('0003-codex-turn.md').includes('\none\n'));
});

test('missing prompt or final is reported without inventing text; pending can recover', t => {
  const f = fixture(t);
  assert.match(f.run('Stop', { last_assistant_message: 'answer' }).systemMessage, /prompt-not-captured/);
  f.run('UserPromptSubmit', { prompt: 'pending' });
  assert.match(f.run('Stop', { last_assistant_message: null }).systemMessage, /missing-final-message/);
  assert.equal(f.files().length, 1);
  f.run('Stop', { last_assistant_message: 'real answer' });
  assert.equal(f.files().length, 2);
});

test('missing IDs and unknown events never capture unpaired or tool data', t => {
  const f = fixture(t);
  assert.ok(f.run('UserPromptSubmit', { turn_id: undefined, prompt: 'secret' }).systemMessage);
  assert.deepEqual(f.run('PostToolUse', { tool_response: 'secret' }), {});
  assert.equal(f.files().length, 1);
});

test('lock contention fails open without leaking payload and can retry', t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.root, '.chat-history', 'lock'), { recursive: true });
  const result = f.run('UserPromptSubmit', { prompt: 'secret-api-key-value' });
  assert.match(result.systemMessage, /busy/);
  assert.ok(!JSON.stringify(result).includes('secret-api-key-value'));
  fs.rmdirSync(path.join(f.root, '.chat-history', 'lock'));
  f.run('UserPromptSubmit', { prompt: 'retry' });
  f.run('Stop', { last_assistant_message: 'ok' });
  assert.equal(f.files().length, 2);
});

test('disabled switch skips recording', t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.root, '.chat-history'));
  fs.writeFileSync(path.join(f.root, '.chat-history', 'disabled'), '');
  assert.deepEqual(f.run('UserPromptSubmit', { prompt: 'skip' }), {});
  assert.equal(f.files().length, 1);
});

test('wrong workspace is ignored', t => {
  const f = fixture(t);
  assert.deepEqual(f.run('UserPromptSubmit', { cwd: os.tmpdir(), prompt: 'skip' }), {});
  assert.equal(f.files().length, 1);
});

test('write failure fails open and keeps pending data', t => {
  const f = fixture(t);
  f.run('UserPromptSubmit', { prompt: 'keep me' });
  fs.renameSync(path.join(f.root, 'ChatHistory'), path.join(f.root, 'kept-history'));
  fs.writeFileSync(path.join(f.root, 'ChatHistory'), 'not a directory');
  const result = f.run('Stop', { last_assistant_message: 'answer' });
  assert.match(result.systemMessage, /recording-failed/);
  const stateFile = fs.readdirSync(path.join(f.root, '.chat-history')).find(n => n.endsWith('.json'));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.root, '.chat-history', stateFile))).prompts, ['keep me']);
});

test('manual fallback is explicitly labelled and sanitizes task names', t => {
  const f = fixture(t);
  f.run('Manual', { prompt: 'copied prompt', response: 'copied final', task: '../../작업' });
  const name = f.files().find(n => n.startsWith('0002-'));
  assert.ok(!name.includes('/'));
  assert.ok(f.read(name).includes('Source: manual-copy'));
});

test('crash after archive creation can recover without duplicate file', t => {
  const f = fixture(t);
  f.run('UserPromptSubmit', { prompt: 'original' });
  const dir = path.join(f.root, '.chat-history');
  const stateFile = path.join(dir, fs.readdirSync(dir).find(n => n.endsWith('.json')));
  const pending = fs.readFileSync(stateFile);
  f.run('Stop', { last_assistant_message: 'answer' });
  fs.writeFileSync(stateFile, pending);
  f.run('Stop', { last_assistant_message: 'answer' });
  assert.equal(f.files().length, 2);
});

test('CLI invalid JSON exits successfully with safe JSON warning', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'chat-history.cjs')],
    { input: 'not-json secret-value', encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(JSON.parse(result.stdout).systemMessage, /invalid-input/);
  assert.ok(!result.stdout.includes('secret-value'));
  assert.equal(result.stderr, '');
});

test('real CLI processes hook stdin end to end in an isolated workspace', t => {
  const f = fixture(t);
  const scriptDir = path.join(f.root, 'scripts');
  fs.mkdirSync(scriptDir);
  const script = path.join(scriptDir, 'chat-history.cjs');
  fs.copyFileSync(path.join(__dirname, 'chat-history.cjs'), script);
  const call = event => {
    const result = spawnSync(process.execPath, [script], { input: JSON.stringify(event), encoding: 'utf8', cwd: f.root });
    assert.equal(result.status, 0);
    assert.deepEqual(JSON.parse(result.stdout), {});
    assert.equal(result.stderr, '');
  };
  call(f.event('UserPromptSubmit', { prompt: 'CLI 프롬프트\r\n원문' }));
  call(f.event('Stop', { last_assistant_message: 'CLI 최종 답변\n원문' }));
  assert.ok(f.read('0002-codex-turn.md').includes('CLI 프롬프트\r\n원문'));
  assert.ok(f.read('0002-codex-turn.md').includes('CLI 최종 답변\n원문'));
});

test('hook config keeps both events and resolves the recorder through Git without absolute paths', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.codex', 'hooks.json')));
  assert.deepEqual(Object.keys(config.hooks).sort(), ['Stop', 'UserPromptSubmit']);
  for (const groups of Object.values(config.hooks)) {
    const hook = groups[0].hooks[0];
    assert.equal(hook.type, 'command');
    assert.equal(hook.timeout, 5);
    assert.match(hook.command, /^node -e "/);
    assert.match(hook.command, /rev-parse.*--show-toplevel/);
    assert.match(hook.command, /scripts.*chat-history\.cjs/);
    assert.doesNotMatch(hook.command, /[A-Za-z]:[\\/]/);
  }
  assert.equal(config.hooks.Stop[0].hooks[0].command, config.hooks.UserPromptSubmit[0].hooks[0].command);
});

function runHook(command, cwd, event, shell) {
  const options = { cwd, input: JSON.stringify(event), encoding: 'utf8', timeout: 10000 };
  return shell === 'powershell'
    ? spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], options)
    : spawnSync(command, { ...options, shell: true });
}

for (const shell of ['default-shell', 'powershell']) {
  test(`configured Hook records across a Windows repository move and nested cwd (${shell})`,
    { skip: shell === 'powershell' && process.platform !== 'win32' }, t => {
      const f = fixture(t);
      let repo = path.join(f.root, 'original checkout');
      fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
      fs.cpSync(path.join(f.root, 'ChatHistory'), path.join(repo, 'ChatHistory'), { recursive: true });
      fs.copyFileSync(path.join(__dirname, 'chat-history.cjs'), path.join(repo, 'scripts', 'chat-history.cjs'));
      const init = spawnSync('git', ['init', '-q'], { cwd: repo, encoding: 'utf8' });
      assert.equal(init.status, 0, init.stderr);
      const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.codex', 'hooks.json')));
      const call = (kind, extra = {}, nested = false) => {
        const cwd = nested ? path.join(repo, 'nested folder') : repo;
        const result = runHook(config.hooks[kind][0].hooks[0].command, cwd,
          f.event(kind, { cwd, ...extra }), shell);
        assert.equal(result.error, undefined);
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(JSON.parse(result.stdout), {}, result.stdout);
        assert.equal(result.stderr, '');
      };
      call('UserPromptSubmit', { prompt: '이동 전 프롬프트\r\n원문' });
      assert.ok(fs.existsSync(path.join(repo, '.chat-history')), JSON.stringify({
        gitRoot: spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: repo, encoding: 'utf8' }).stdout.trim(),
        realRoot: fs.realpathSync(repo), nativeRoot: fs.realpathSync.native(repo),
      }));
      const moved = path.join(f.root, "이동한 저장소 & 공백 ' 달러$ (test)");
      fs.renameSync(repo, moved);
      repo = moved;
      fs.mkdirSync(path.join(repo, 'nested folder'));
      call('Stop', { last_assistant_message: '이동 후 최종 응답\n원문' }, true);
      const first = fs.readFileSync(path.join(repo, 'ChatHistory', '0002-codex-turn.md'), 'utf8');
      assert.ok(first.includes('이동 전 프롬프트\r\n원문'));
      assert.ok(first.includes('이동 후 최종 응답\n원문'));
      call('UserPromptSubmit', { turn_id: 'next', prompt: '하위 폴더 요청' }, true);
      call('Stop', { turn_id: 'next', last_assistant_message: '다음 응답' }, true);
      assert.ok(fs.existsSync(path.join(repo, 'ChatHistory', '0003-codex-turn.md')));
      assert.equal(fs.readFileSync(path.join(repo, 'ChatHistory', '0001-create-agents.md'), 'utf8'), 'KEEP EXACTLY\r\n');
      assert.equal(fs.readFileSync(path.join(repo, 'ChatHistory', '0002-codex-turn.md'), 'utf8'), first);
    });
}

test('configured Hook fails open outside Git without storing a fabricated conversation', t => {
  const f = fixture(t);
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.codex', 'hooks.json')));
  const result = runHook(config.hooks.Stop[0].hooks[0].command, f.root,
    f.event('Stop', { last_assistant_message: 'not archived' }), 'default-shell');
  assert.equal(result.status, 0);
  assert.match(JSON.parse(result.stdout).systemMessage, /git-root-launch-failed/);
  assert.equal(result.stderr, '');
  assert.equal(f.files().length, 1);
});

test('detects representative secret patterns without treating ordinary discussion as a secret', () => {
  for (const text of [
    'sk-proj-' + 'x'.repeat(30), 'ghp_' + 'x'.repeat(36),
    'AKIA' + 'A'.repeat(16), '-----BEGIN RSA PRIVATE KEY-----',
    'Authorization: Bearer ' + 'x'.repeat(24),
    'PASSWORD=' + 'fictional-value', '"api_key": "fictional-value"',
    '비밀번호는 가상의값입니다',
  ]) assert.equal(hasSensitiveText(text), true);
  assert.equal(hasSensitiveText('비밀번호, API Key 등 민감 정보를 기록하지 마세요.'), false);
});

test('sensitive prompt is withheld from history and pending storage, without blocking work', t => {
  const f = fixture(t);
  const secret = 'sk-proj-' + 'x'.repeat(30);
  const result = f.run('UserPromptSubmit', { prompt: secret });
  assert.match(result.systemMessage, /sensitive-content/);
  assert.ok(!JSON.stringify(result).includes(secret));
  f.run('Stop', { last_assistant_message: 'benign answer' });
  assert.equal(f.files().length, 1);
  const dir = path.join(f.root, '.chat-history');
  for (const filename of fs.readdirSync(dir)) {
    assert.ok(!fs.readFileSync(path.join(dir, filename), 'utf8').includes(secret));
  }
  f.run('UserPromptSubmit', { turn_id: 'next-safe-turn', prompt: 'safe request' });
  f.run('Stop', { turn_id: 'next-safe-turn', last_assistant_message: 'safe answer' });
  assert.ok(f.files().includes('0002-codex-turn.md'));
});

test('sensitive response or later submission withholds the entire turn', t => {
  const f = fixture(t);
  f.run('UserPromptSubmit', { prompt: 'safe prompt' });
  assert.ok(f.run('Stop', { last_assistant_message: 'password=fictional-secret' }).systemMessage);
  assert.equal(f.files().length, 1);
  f.run('UserPromptSubmit', { turn_id: 'turn-2', prompt: 'first safe message' });
  f.run('UserPromptSubmit', { turn_id: 'turn-2', prompt: 'api_key=fictional-secret' });
  f.run('Stop', { turn_id: 'turn-2', last_assistant_message: 'done' });
  assert.equal(f.files().length, 1);
});

test('manual capture applies secret detection to prompt, response and filename task', t => {
  const f = fixture(t);
  for (const field of ['prompt', 'response', 'task']) {
    const result = f.run('Manual', { prompt: 'safe', response: 'safe', task: 'manual',
      turn_id: field, [field]: 'sk-proj-' + 'x'.repeat(30) });
    assert.ok(result.systemMessage);
  }
  assert.equal(f.files().length, 1);
});

test('working-tree checker finds suspicious Markdown without changing existing files', t => {
  const f = fixture(t);
  assert.deepEqual(checkHistory(f.root), { checked: 1, suspicious: 0, failed: false });
  fs.writeFileSync(path.join(f.root, 'ChatHistory', '0002-test.md'), 'password=fictional-secret');
  assert.deepEqual(checkHistory(f.root), { checked: 2, suspicious: 1, failed: false });
  assert.equal(f.read('0001-create-agents.md'), 'KEEP EXACTLY\r\n');
  assert.equal(f.read('0002-test.md'), 'password=fictional-secret');
});

test('staged checker checks the Git index even if working-tree content was replaced', t => {
  const f = fixture(t);
  const git = args => {
    const result = spawnSync('git', args, { cwd: f.root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  git(['init', '-q']);
  fs.writeFileSync(path.join(f.root, 'ChatHistory', '0002-test.md'), 'password=fictional-secret');
  git(['add', '--', 'ChatHistory']);
  fs.writeFileSync(path.join(f.root, 'ChatHistory', '0002-test.md'), 'safe working copy');
  assert.deepEqual(checkHistory(f.root), { checked: 2, suspicious: 0, failed: false });
  assert.deepEqual(checkHistory(f.root, true), { checked: 2, suspicious: 1, failed: false });
});

test('staged checker fails safely outside a Git repository', t => {
  const f = fixture(t);
  assert.deepEqual(checkHistory(f.root, true), { checked: 0, suspicious: 0, failed: true });
});

test('Git permits ChatHistory Markdown while ignoring only recorder state', () => {
  const cwd = path.join(__dirname, '..');
  const ignored = name => spawnSync('git', ['check-ignore', '--no-index', '--quiet', '--', name], { cwd }).status;
  assert.equal(ignored('ChatHistory/0002-codex-turn.md'), 1);
  assert.equal(ignored('.chat-history/example.json'), 0);
});
