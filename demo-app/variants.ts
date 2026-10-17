/**
 * Markup variants of the demo app ("Taskly").
 *
 * v1 is the original markup. v2 renames ids, classes, test ids and button
 * text, which is exactly the kind of refactor that breaks end-to-end tests.
 * Behaviour, structure, labels and ARIA roles are identical in both versions,
 * so a healed locator can always be found through accessibility attributes.
 */
export type AppVersion = '1' | '2';

/** Attributes of one element. Anything missing is simply not rendered. */
export interface El {
  id?: string;
  testId?: string;
  cls?: string;
}

export interface Variant {
  version: AppVersion;
  /** Class added to <body> while dark mode is on. */
  darkClass: string;
  login: {
    form: El;
    username: El;
    password: El;
    remember: El;
    submit: El;
    submitText: string;
    error: El;
  };
  todos: {
    form: El;
    input: El;
    add: El;
    addText: string;
    list: El;
    itemClass: string;
    itemDoneClass: string;
    check: El;
    title: El;
    remove: El;
    count: El;
    clear: El;
  };
  settings: {
    form: El;
    dark: El;
    notify: El;
    language: El;
    save: El;
    saveText: string;
    back: El;
    toast: El;
  };
}

const v1: Variant = {
  version: '1',
  darkClass: 'dark',
  login: {
    form: { id: 'login-form' },
    username: { id: 'username' },
    password: { id: 'password' },
    remember: { id: 'remember', testId: 'remember-me' },
    submit: { id: 'login-btn', cls: 'btn primary' },
    submitText: 'Log in',
    error: { cls: 'error-msg' },
  },
  todos: {
    form: { id: 'todo-form', cls: 'row' },
    input: { id: 'new-todo' },
    add: { cls: 'btn primary add-btn' },
    addText: 'Add task',
    list: { id: 'todo-list', cls: 'todos' },
    itemClass: 'todo-item',
    itemDoneClass: 'done',
    check: { cls: 'toggle' },
    title: { cls: 'todo-title' },
    remove: { cls: 'delete' },
    count: { id: 'count', cls: 'muted' },
    clear: { id: 'clear-done', cls: 'btn link' },
  },
  settings: {
    form: { id: 'settings-form' },
    dark: { id: 'dark-mode' },
    notify: { id: 'notify', testId: 'notify-toggle' },
    language: { id: 'language' },
    save: { id: 'save-settings', cls: 'btn primary' },
    saveText: 'Save settings',
    back: { cls: 'link' },
    toast: { id: 'toast', cls: 'toast' },
  },
};

const v2: Variant = {
  version: '2',
  darkClass: 'theme-dark',
  login: {
    form: { testId: 'login-form', cls: 'form' },
    username: { id: 'user-field', testId: 'user-field', cls: 'input' },
    password: { id: 'pass-field', testId: 'pass-field', cls: 'input' },
    remember: { id: 'remember-me-toggle', testId: 'remember' },
    submit: { testId: 'signin', cls: 'btn btn-primary' },
    submitText: 'Sign in',
    error: { testId: 'auth-error', cls: 'alert alert-danger' },
  },
  todos: {
    form: { testId: 'task-form', cls: 'row' },
    input: { id: 'task-input', testId: 'task-input', cls: 'input' },
    add: { testId: 'task-add', cls: 'btn btn-primary' },
    addText: 'New task',
    list: { testId: 'task-list', cls: 'tasks' },
    itemClass: 'task',
    itemDoneClass: 'is-done',
    check: { cls: 'task-check', testId: 'task-done' },
    title: { cls: 'task-title' },
    remove: { cls: 'icon-btn task-remove', testId: 'task-delete' },
    count: { id: 'task-count', testId: 'task-count', cls: 'hint' },
    clear: { testId: 'clear-done', cls: 'btn btn-ghost' },
  },
  settings: {
    form: { testId: 'settings-form' },
    dark: { id: 'theme-toggle', testId: 'theme-toggle' },
    notify: { id: 'notifications', testId: 'notifications' },
    language: { id: 'lang-select', testId: 'lang-select', cls: 'select' },
    // In v2 the "back" link is styled as a button too, so `.btn` now matches
    // two elements on this page: a strict-mode violation for v1 tests.
    save: { testId: 'save', cls: 'btn' },
    saveText: 'Save changes',
    back: { cls: 'btn btn-link' },
    toast: { testId: 'notice', cls: 'snackbar' },
  },
};

export function normaliseVersion(value: string | undefined): AppVersion {
  if (value === undefined || value === '' || value === '1') return '1';
  if (value === '2') return '2';
  throw new Error(`APP_VERSION must be "1" or "2", got "${value}"`);
}

export function getVariant(version: AppVersion): Variant {
  return version === '2' ? v2 : v1;
}

/** Render the HTML attributes for an element. */
export function attrs(el: El): string {
  const parts: string[] = [];
  if (el.id) parts.push(`id="${el.id}"`);
  if (el.testId) parts.push(`data-testid="${el.testId}"`);
  if (el.cls) parts.push(`class="${el.cls}"`);
  return parts.join(' ');
}

/** A CSS selector the client-side script can use to find the element. */
export function selector(el: El): string {
  if (el.id) return `#${el.id}`;
  if (el.testId) return `[data-testid="${el.testId}"]`;
  if (el.cls) return `.${el.cls.split(' ')[0]}`;
  throw new Error('element has no id, test id or class');
}
