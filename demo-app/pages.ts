import { attrs, selector, type Variant } from './variants.js';

/** Configuration handed to public/app.js so one script serves both versions. */
function clientConfig(v: Variant): Record<string, unknown> {
  return {
    version: v.version,
    darkClass: v.darkClass,
    itemClass: v.todos.itemClass,
    itemDoneClass: v.todos.itemDoneClass,
    itemAttrs: {
      check: attrs(v.todos.check),
      title: attrs(v.todos.title),
      remove: attrs(v.todos.remove),
    },
    sel: {
      loginForm: selector(v.login.form),
      username: selector(v.login.username),
      password: selector(v.login.password),
      loginError: selector(v.login.error),
      todoForm: selector(v.todos.form),
      todoInput: selector(v.todos.input),
      todoList: selector(v.todos.list),
      todoCount: selector(v.todos.count),
      todoClear: selector(v.todos.clear),
      settingsForm: selector(v.settings.form),
      dark: selector(v.settings.dark),
      notify: selector(v.settings.notify),
      language: selector(v.settings.language),
      toast: selector(v.settings.toast),
    },
  };
}

function layout(v: Variant, title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Taskly</title>
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<header class="topbar">
  <a class="brand" href="/login">Taskly</a>
  <nav aria-label="Main">
    <a href="/todos">Tasks</a>
    <a href="/settings">Settings</a>
  </nav>
</header>
${body}
<script>window.__APP__ = ${JSON.stringify(clientConfig(v))};</script>
<script src="/app.js"></script>
</body>
</html>
`;
}

export function renderLogin(v: Variant): string {
  const l = v.login;
  return layout(
    v,
    'Login',
    `<main class="card">
  <h1>Welcome back</h1>
  <p class="muted">Sign in to see your tasks. Try <code>alice</code> / <code>secret123</code>.</p>
  <form ${attrs(l.form)} novalidate>
    <label for="${l.username.id}">Username</label>
    <input ${attrs(l.username)} name="username" type="text" autocomplete="username">
    <label for="${l.password.id}">Password</label>
    <input ${attrs(l.password)} name="password" type="password" autocomplete="current-password">
    <div class="row">
      <input ${attrs(l.remember)} name="remember" type="checkbox">
      <label for="${l.remember.id}">Remember me</label>
    </div>
    <button ${attrs(l.submit)} type="submit">${l.submitText}</button>
    <p ${attrs(l.error)} role="alert" hidden>Invalid username or password</p>
  </form>
</main>`,
  );
}

export function renderTodos(v: Variant): string {
  const t = v.todos;
  return layout(
    v,
    'Tasks',
    `<main class="card">
  <h1>Your tasks</h1>
  <p class="muted who">Signed in as guest</p>
  <form ${attrs(t.form)}>
    <label for="${t.input.id}" class="sr-only">Task title</label>
    <input ${attrs(t.input)} name="title" type="text" placeholder="What needs doing?" autocomplete="off">
    <button ${attrs(t.add)} type="submit">${t.addText}</button>
  </form>
  <ul ${attrs(t.list)} aria-label="Tasks"></ul>
  <p ${attrs(t.count)}>0 tasks left</p>
  <button ${attrs(t.clear)} type="button" hidden>Clear completed</button>
</main>`,
  );
}

export function renderSettings(v: Variant): string {
  const s = v.settings;
  return layout(
    v,
    'Settings',
    `<main class="card">
  <h1>Settings</h1>
  <form ${attrs(s.form)}>
    <div class="row">
      <input ${attrs(s.dark)} name="dark" type="checkbox">
      <label for="${s.dark.id}">Dark mode</label>
    </div>
    <div class="row">
      <input ${attrs(s.notify)} name="notify" type="checkbox">
      <label for="${s.notify.id}">Email notifications</label>
    </div>
    <label for="${s.language.id}">Language</label>
    <select ${attrs(s.language)} name="language">
      <option value="en">English</option>
      <option value="de">German</option>
      <option value="es">Spanish</option>
    </select>
    <div class="actions">
      <button ${attrs(s.save)} type="submit">${s.saveText}</button>
      <a ${attrs(s.back)} href="/todos">Back to tasks</a>
    </div>
  </form>
  <div ${attrs(s.toast)} role="status" hidden>Settings saved</div>
</main>`,
  );
}
