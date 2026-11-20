// Loads the dashboard's classic scripts into one bare context so their pure functions can be tested
// without a browser. The scripts share a global scope in production; a vm context reproduces that.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

/**
 * @param {string[]} files  script names under the repo root, in load order
 * @param {object} globals  stand-ins for what the page provides (STATE, monthFilter, ...)
 * @returns {(expression:string) => any} evaluates an expression inside the context
 */
function loadScripts(files, globals = {}){
  const context = vm.createContext({ console, ...globals });
  for(const file of files){
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    vm.runInContext(source, context, { filename: file });
  }
  return expression => vm.runInContext(expression, context);
}

module.exports = { loadScripts };
