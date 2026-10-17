/* Client-side behaviour of the Taskly demo app.
 * The server injects window.__APP__ with the selectors of the current markup
 * version, so this file is identical for v1 and v2. */
(function () {
  'use strict';
  var cfg = window.__APP__ || {};
  var S = cfg.sel || {};

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  if (localStorage.getItem('taskly.dark') === '1') {
    document.body.classList.add(cfg.darkClass);
  }

  var path = location.pathname;
  if (path === '/login') initLogin();
  else if (path === '/todos') initTodos();
  else if (path === '/settings') initSettings();

  function initLogin() {
    var form = $(S.loginForm);
    var user = $(S.username);
    var pass = $(S.password);
    var error = $(S.loginError);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (user.value.trim() === 'alice' && pass.value === 'secret123') {
        sessionStorage.setItem('taskly.user', user.value.trim());
        location.assign('/todos');
      } else {
        error.hidden = false;
      }
    });
  }

  function initTodos() {
    var who = $('.who');
    var user = sessionStorage.getItem('taskly.user');
    if (user) who.textContent = 'Signed in as ' + user;

    var form = $(S.todoForm);
    var input = $(S.todoInput);
    var list = $(S.todoList);
    var count = $(S.todoCount);
    var clear = $(S.todoClear);
    var tasks = [];

    function updateSummary() {
      var left = tasks.filter(function (t) { return !t.done; }).length;
      count.textContent = left + (left === 1 ? ' task left' : ' tasks left');
      clear.hidden = !tasks.some(function (t) { return t.done; });
    }

    function render() {
      list.innerHTML = '';
      tasks.forEach(function (task) {
        var li = document.createElement('li');
        li.className = cfg.itemClass + (task.done ? ' ' + cfg.itemDoneClass : '');
        li.innerHTML =
          '<input type="checkbox" ' + cfg.itemAttrs.check +
          ' aria-label="Mark ' + esc(task.title) + ' as done"' + (task.done ? ' checked' : '') + '>' +
          '<span ' + cfg.itemAttrs.title + '>' + esc(task.title) + '</span>' +
          '<button type="button" ' + cfg.itemAttrs.remove +
          ' aria-label="Delete ' + esc(task.title) + '">&times;</button>';
        li.querySelector('input').addEventListener('change', function (event) {
          task.done = event.target.checked;
          li.classList.toggle(cfg.itemDoneClass, task.done);
          updateSummary();
        });
        li.querySelector('button').addEventListener('click', function () {
          tasks.splice(tasks.indexOf(task), 1);
          render();
        });
        list.appendChild(li);
      });
      updateSummary();
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var title = input.value.trim();
      if (!title) return;
      tasks.push({ title: title, done: false });
      input.value = '';
      render();
    });
    clear.addEventListener('click', function () {
      tasks = tasks.filter(function (t) { return !t.done; });
      render();
    });
    render();
  }

  function initSettings() {
    var form = $(S.settingsForm);
    var dark = $(S.dark);
    var notify = $(S.notify);
    var language = $(S.language);
    var toast = $(S.toast);
    var timer = null;

    dark.checked = document.body.classList.contains(cfg.darkClass);
    dark.addEventListener('change', function () {
      document.body.classList.toggle(cfg.darkClass, dark.checked);
      localStorage.setItem('taskly.dark', dark.checked ? '1' : '0');
    });
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      localStorage.setItem(
        'taskly.settings',
        JSON.stringify({ notify: notify.checked, language: language.value })
      );
      toast.hidden = false;
      clearTimeout(timer);
      timer = setTimeout(function () { toast.hidden = true; }, 4000);
    });
  }
})();
