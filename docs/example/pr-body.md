# fix(tests): self-heal 18 locators

The self-healing agent saw **10** failing test(s) with **18** locator failure(s), healed **18** locator(s) in **10** test(s) and confirmed every patched file with a green run.

Please review each replacement: the agent only sees the page, not the product. Nothing is merged automatically.

## Healed locators

| Test | Old locator | New locator | Confidence | Reason |
|---|---|---|---|---|
| tests/login.spec.ts › shows an error for a wrong password (L11) | `page.locator('#login-btn')` | `page.getByRole('button', { name: 'Sign in' })` | 0.95 | The only submit button in the login form; its text changed from 'Log in' to 'Sign in'. |
| tests/login.spec.ts › signs in and lands on the task list (L19) | `page.getByRole('button', { name: 'Log in' })` | `page.getByRole('button', { name: 'Sign in' })` | 0.95 | Same submit button; its label is now 'Sign in'. |
| tests/login.spec.ts › lets the user tick "remember me" (L31) | `page.getByTestId('remember-me')` | `page.getByRole('checkbox', { name: 'Remember me' })` | 0.92 | The checkbox is still labelled 'Remember me'; its test id changed to 'remember'. |
| tests/settings.spec.ts › turns on dark mode (L8) | `page.locator('#dark-mode')` | `page.getByLabel('Dark mode')` | 0.95 | The checkbox is still labelled 'Dark mode'; its id is now theme-toggle. |
| tests/settings.spec.ts › saves the language choice (L14) | `page.locator('#language')` | `page.getByLabel('Language')` | 0.95 | The select is still labelled 'Language'; its id is now lang-select. |
| tests/settings.spec.ts › keeps email notifications off until switched on (L24) | `page.getByTestId('notify-toggle')` | `page.getByTestId('notifications')` | 0.90 | Same checkbox under its new test id. |
| tests/todos.spec.ts › adds a task (L13) | `page.locator('#new-todo')` | `page.getByLabel('Task title')` | 0.90 | The text input keeps its visually hidden label 'Task title'; the id changed to task-input. |
| tests/todos.spec.ts › marks a task as done (L21) | `page.getByRole('button', { name: 'Add task' })` | `page.getByRole('button', { name: 'New task' })` | 0.95 | The form's submit button was renamed from 'Add task' to 'New task'. |
| tests/todos.spec.ts › deletes a task (L28) | `page.getByRole('button', { name: 'Add task' })` | `page.getByRole('button', { name: 'New task' })` | 0.95 | The form's submit button was renamed from 'Add task' to 'New task'. |
| tests/todos.spec.ts › shows how many tasks are left (L35) | `page.getByRole('button', { name: 'Add task' })` | `page.getByRole('button', { name: 'New task' })` | 0.95 | The form's submit button was renamed from 'Add task' to 'New task'. |
| tests/login.spec.ts › shows an error for a wrong password (L12) | `page.locator('.error-msg')` | `page.getByRole('alert')` | 0.90 | The error paragraph keeps role=alert; the class was renamed to alert-danger. |
| tests/settings.spec.ts › saves the language choice (L17) | `page.locator('.btn')` | `page.getByRole('button', { name: 'Save changes' })` | 0.78 | The form's only button; its text changed from 'Save settings' to 'Save changes'. |
| tests/todos.spec.ts › adds a task (L14) | `page.getByText('Add task')` | `page.getByRole('button', { name: 'New task' })` | 0.93 | The form's submit button was renamed from 'Add task' to 'New task'. |
| tests/todos.spec.ts › marks a task as done (L22) | `page.locator('.toggle')` | `page.getByRole('checkbox', { name: 'Mark Buy milk as done' })` | 0.90 | The task checkbox keeps its aria-label; the class is now task-check. |
| tests/todos.spec.ts › deletes a task (L29) | `page.locator('.delete')` | `page.getByRole('button', { name: 'Delete Buy milk' })` | 0.90 | The delete button keeps its aria-label; the class is now task-remove. |
| tests/todos.spec.ts › shows how many tasks are left (L37) | `page.getByRole('button', { name: 'Add task' })` | `page.getByRole('button', { name: 'New task' })` | 0.95 | The form's submit button was renamed from 'Add task' to 'New task'. |
| tests/settings.spec.ts › saves the language choice (L18) | `page.locator('#toast')` | `page.getByRole('status')` | 0.88 | The toast keeps role=status; its id was replaced by data-testid=notice. |
| tests/todos.spec.ts › shows how many tasks are left (L38) | `page.locator('#count')` | `page.getByTestId('task-count')` | 0.90 | The remaining-count paragraph now carries data-testid=task-count. |

## Before screenshots

<details>
<summary>tests/login.spec.ts › shows an error for a wrong password — page.locator('#login-btn')</summary>

![shows an error for a wrong password before the heal](heal-output/screenshots/heal-001-before.png)

</details>

<details>
<summary>tests/login.spec.ts › signs in and lands on the task list — page.getByRole('button', { name: 'Log in' })</summary>

![signs in and lands on the task list before the heal](heal-output/screenshots/heal-002-before.png)

</details>

<details>
<summary>tests/login.spec.ts › lets the user tick "remember me" — page.getByTestId('remember-me')</summary>

![lets the user tick "remember me" before the heal](heal-output/screenshots/heal-003-before.png)

</details>

<details>
<summary>tests/settings.spec.ts › turns on dark mode — page.locator('#dark-mode')</summary>

![turns on dark mode before the heal](heal-output/screenshots/heal-004-before.png)

</details>

<details>
<summary>tests/settings.spec.ts › saves the language choice — page.locator('#language')</summary>

![saves the language choice before the heal](heal-output/screenshots/heal-005-before.png)

</details>

<details>
<summary>tests/settings.spec.ts › keeps email notifications off until switched on — page.getByTestId('notify-toggle')</summary>

![keeps email notifications off until switched on before the heal](heal-output/screenshots/heal-006-before.png)

</details>

<details>
<summary>tests/todos.spec.ts › adds a task — page.locator('#new-todo')</summary>

![adds a task before the heal](heal-output/screenshots/heal-007-before.png)

</details>

<details>
<summary>tests/todos.spec.ts › marks a task as done — page.getByRole('button', { name: 'Add task' })</summary>

![marks a task as done before the heal](heal-output/screenshots/heal-008-before.png)

</details>

<details>
<summary>tests/todos.spec.ts › deletes a task — page.getByRole('button', { name: 'Add task' })</summary>

![deletes a task before the heal](heal-output/screenshots/heal-009-before.png)

</details>

<details>
<summary>tests/todos.spec.ts › shows how many tasks are left — page.getByRole('button', { name: 'Add task' })</summary>

![shows how many tasks are left before the heal](heal-output/screenshots/heal-010-before.png)

</details>

<details>
<summary>tests/login.spec.ts › shows an error for a wrong password — page.locator('.error-msg')</summary>

![shows an error for a wrong password before the heal](heal-output/screenshots/heal-011-before.png)

</details>

<details>
<summary>tests/settings.spec.ts › saves the language choice — page.locator('.btn')</summary>

![saves the language choice before the heal](heal-output/screenshots/heal-012-before.png)

</details>

<details>
<summary>tests/todos.spec.ts › adds a task — page.getByText('Add task')</summary>

![adds a task before the heal](heal-output/screenshots/heal-013-before.png)

</details>

<details>
<summary>tests/todos.spec.ts › marks a task as done — page.locator('.toggle')</summary>

![marks a task as done before the heal](heal-output/screenshots/heal-014-before.png)

</details>

<details>
<summary>tests/todos.spec.ts › deletes a task — page.locator('.delete')</summary>

![deletes a task before the heal](heal-output/screenshots/heal-015-before.png)

</details>

<details>
<summary>tests/todos.spec.ts › shows how many tasks are left — page.getByRole('button', { name: 'Add task' })</summary>

![shows how many tasks are left before the heal](heal-output/screenshots/heal-016-before.png)

</details>

<details>
<summary>tests/settings.spec.ts › saves the language choice — page.locator('#toast')</summary>

![saves the language choice before the heal](heal-output/screenshots/heal-017-before.png)

</details>

<details>
<summary>tests/todos.spec.ts › shows how many tasks are left — page.locator('#count')</summary>

![shows how many tasks are left before the heal](heal-output/screenshots/heal-018-before.png)

</details>


## Heal report

- Provider: mock
- Rounds: 4 · Tokens: 0 in / 0 out · Estimated cost: $0.0000
- Run: 2026-10-17T08:05:31.518Z → 2026-10-17T08:06:11.154Z (39.6s) · APP_VERSION=2

<details>
<summary>Candidates that were checked</summary>

| Heal | Candidate | Result |
|---|---|---|
| heal-001 | `page.getByRole('button', { name: 'Sign in' })` | passed: matches 1 element(s) and click succeeded |
| heal-002 | `page.getByRole('button', { name: 'Sign in' })` | passed: matches 1 element(s) and click succeeded |
| heal-003 | `page.getByRole('checkbox', { name: 'Remember me' })` | passed: matches 1 element(s) and check succeeded |
| heal-004 | `page.getByLabel('Dark mode')` | passed: matches 1 element(s) and check succeeded |
| heal-005 | `page.getByLabel('Language')` | passed: matches 1 element(s) and selectOption succeeded |
| heal-006 | `page.getByTestId('notifications')` | passed: matches 1 element(s) and check succeeded |
| heal-007 | `page.getByLabel('Task title')` | passed: matches 1 element(s) and fill succeeded |
| heal-008 | `page.getByRole('button', { name: 'New task' })` | passed: matches 1 element(s) and click succeeded |
| heal-009 | `page.getByRole('button', { name: 'New task' })` | passed: matches 1 element(s) and click succeeded |
| heal-010 | `page.getByRole('button', { name: 'New task' })` | passed: matches 1 element(s) and click succeeded |
| heal-011 | `page.getByRole('alert')` | passed: matches 1 element(s) and expect.toHaveText succeeded |
| heal-012 | `page.locator('form .btn')` | rejected: matches 2 elements, expected 1 |
| heal-012 | `page.getByRole('button', { name: 'Save changes' })` | passed: matches 1 element(s) and click succeeded |
| heal-013 | `page.getByRole('button', { name: 'New task' })` | passed: matches 1 element(s) and click succeeded |
| heal-014 | `page.getByRole('checkbox', { name: 'Mark Buy milk as done' })` | passed: matches 1 element(s) and check succeeded |
| heal-015 | `page.getByRole('button', { name: 'Delete Buy milk' })` | passed: matches 1 element(s) and click succeeded |
| heal-016 | `page.getByRole('button', { name: 'New task' })` | passed: matches 1 element(s) and click succeeded |
| heal-017 | `page.getByRole('status')` | passed: matches 1 element(s) and expect.toHaveText succeeded |
| heal-018 | `page.getByTestId('task-count')` | passed: matches 1 element(s) and expect.toHaveText succeeded |

</details>

---

Opened by selfheal-playwright. Never merged automatically.
