'use strict'
var EventManager = require('../../lib/events')
var yo = require('yo-yo')
var csjs = require('csjs-inject')
var ace = require('brace')

require('brace/theme/tomorrow_night_blue')

var globalRegistry = require('../../global/registry')

var Range = ace.acequire('ace/range').Range
require('brace/ext/language_tools')
require('brace/ext/searchbox')
var langTools = ace.acequire('ace/ext/language_tools')
require('ace-mode-solidity/build/remix-ide/mode-solidity')
require('brace/mode/javascript')
require('brace/mode/python')
require('brace/mode/json')
var styleGuide = require('../ui/styles-guide/theme-chooser')
var styles = styleGuide.chooser()

function setTheme (cb) {
  if (styles.appProperties.aceTheme) {
    cb('brace/theme/', styles.appProperties.aceTheme)
  }
}

setTheme((path, theme) => {
  require('brace/theme/tomorrow_night_blue')
})

var css = csjs`
  .ace-editor {
    background-color  : ${styles.editor.backgroundColor_Editor};
    width     : 49%;
  }
`
document.head.appendChild(yo`
  <style>
    .ace-tm .ace_gutter,
    .ace-tm .ace_gutter-active-line,
    .ace-tm .ace_marker-layer .ace_active-line {
        background-color: ${styles.editor.backgroundColor_Tabs_Highlights};
    }
    .ace_gutter-cell.ace_breakpoint{
      background-color: ${styles.editor.backgroundColor_DebuggerMode};
    }
    .highlightreference {
      position:absolute;
      z-index:20;
      background-color: ${styles.editor.backgroundColor_Editor_Context_Highlights};
      opacity: 0.7
    }

    .highlightreferenceline {
      position:absolute;
      z-index:20;
      background-color: ${styles.editor.backgroundColor_Editor_Context_Highlights};
      opacity: 0.7
    }

    .highlightcode {
      position:absolute;
      z-index:20;
      background-color: ${styles.editor.backgroundColor_Editor_Context_Error_Highlights};
     }
  </style>
`)

function Disass (opts = {}, localRegistry) {
  var self = this
  var el = yo`<div id="disas"></div>`
  var editor = ace.edit(el)
  if (styles.appProperties.aceTheme) {
    editor.setTheme('ace/theme/' + styles.appProperties.aceTheme)
  }
  self._components = {}
  self._components.registry = localRegistry || globalRegistry
  self._deps = {
    fileManager: self._components.registry.get('filemanager').api,
    config: self._components.registry.get('config').api
  }

  ace.acequire('ace/ext/language_tools')
  editor.setOptions({
    enableBasicAutocompletion: true,
    enableLiveAutocompletion: true
  })
  var flowCompleter = {
    getCompletions: function (editor, session, pos, prefix, callback) {
      // @TODO add here other propositions
    }
  }
  langTools.addCompleter(flowCompleter)
  el.className += ' ' + css['ace-editor']
  el.editor = editor // required to access the editor during tests
  self.render = function () { return el }
  var event = new EventManager()
  self.event = event
  var compilationResults = {}
  var sessions = {}
  var sourceAnnotations = []
  var currentSession

  var emptySession = createSession('')
  var modes = {
    'txt': 'ace/mode/text',
    'json': 'ace/mode/json'
  }

  this.editorFontSize = function (incr) {
    editor.setFontSize(editor.getFontSize() + incr)
  }

  this.setText = function (text) {
    if (currentSession && sessions[currentSession]) {
      sessions[currentSession].setValue(text)
    }
  }

  function createSession (content, mode) {
    var s = new ace.EditSession(content)
    s.setMode(mode || 'ace/mode/text')
    s.setUndoManager(new ace.UndoManager())
    s.setTabSize(4)
    s.setUseSoftTabs(true)
    return s
  }

  function switchSession (path) {
    currentSession = path
    if (path == null || !(path in sessions)) {
      editor.setSession(emptySession)
      editor.setReadOnly(true)
    } else {
      editor.setSession(sessions[currentSession])
      editor.setReadOnly(true)
      editor.focus()
    }
  }

  this.getBinary = function (contract, compilationResult) {
    var path = contract.file
    var name = contract.name
    if (!(path in compilationResult)) {
      compilationResults[path] = {}
    }
    compilationResults[path][name] = compilationResult
    compilationResults[path][name].sourceMap = this.parseSourceMap(compilationResult["Runtime Bytecode"].sourceMap)
    // Update the content
    // TODO: If the assembly is the same as before, break
    var content = this.getContent(path)
    console.log(path, compilationResult)
    if (!(path in sessions)) {
      sessions[path] = createSession(content, modes['evm'])
    } else {
      sessions[path].setValue(content)
    }
    switchSession(currentSession)
  }

  this.getContent = function (path) {
    var res = ''
    for (var contract in compilationResults[path]) {
      var lines = this.splitAsm(compilationResults[path][contract]["Runtime Bytecode"].opcodes)
      console.log(lines)
      res += lines.join('\n')
    }
    return res
  }

  this.splitAsm = function (asm) {
    var res = []
    var tokens = asm.split(' ').map((x) => x.trim()).filter((x) => x.length > 0)
    var i = 0
    while (i < tokens.length) {
      var newInst = tokens[i]
      i++

      if (tokens[i - 1].slice(0, 4) === 'PUSH') {
        newInst += ' ' + tokens[i]
        i++
      }
      res.push(newInst)
    }

    return res
  }

  this.parseSourceMap = function (compressed) {
    var prev = null
    var res = []

    for (var entry of compressed.split(';')) {
      var entries = entry.split(':')
      var s = (entries.length > 0 && entries[0].length > 0 ? entries[0] : prev[0])
      var l = (entries.length > 1 && entries[1].length > 0 ? entries[1] : prev[1])
      var i = (entries.length > 2 && entries[2].length > 0 ? entries[2] : prev[2])
      var j = (entries.length > 3 && entries[3].length > 0 ? entries[3] : prev[3])

      prev = [s, l, i, j]
      res.push(prev)
    }

    return res
  }

  self._deps.fileManager.event.register('currentFileChanged', (path, provider) => {
    console.log('File changed: ', path)
    switchSession(path)
  })

  /**
    * returns the content of the current session
    *
    * @return {String} content of the file referenced by @arg path
    */
  this.currentContent = function () {
    return this.get(this.current())
  }

  /**
    * returns the content of the session targeted by @arg path
    * if @arg path is null, the content of the current session is returned
    *
    * @return {String} content of the file referenced by @arg path
    */
  this.get = function (path) {
    if (!path || currentSession === path) {
      return editor.getValue()
    } else if (sessions[path]) {
      return sessions[path].getValue()
    }
  }

  /**
    * returns the path of the currently editing file
    * returns `undefined` if no session is being editer
    *
    * @return {String} path of the current session
    */
  this.current = function () {
    if (editor.getSession() === emptySession) {
      return
    }
    return currentSession
  }

  this.getCursorPosition = function () {
    return editor.session.doc.positionToIndex(editor.getCursorPosition(), 0)
  }

  this.discardCurrentSession = function () {
    if (sessions[currentSession]) {
      delete sessions[currentSession]
      currentSession = null
    }
  }

  this.discard = function (path) {
    if (sessions[path]) delete sessions[path]
    if (currentSession === path) currentSession = null
  }

  this.resize = function (useWrapMode) {
    editor.resize()
    var session = editor.getSession()
    session.setUseWrapMode(useWrapMode)
    if (session.getUseWrapMode()) {
      var characterWidth = editor.renderer.characterWidth
      var contentWidth = editor.container.ownerDocument.getElementsByClassName('ace_scroller')[0].clientWidth

      if (contentWidth > 0) {
        session.setWrapLimit(parseInt(contentWidth / characterWidth, 10))
      }
    }
  }

  this.addMarker = function (lineColumnPos, source, cssClass) {
    var currentRange = new Range(lineColumnPos.start.line, lineColumnPos.start.column, lineColumnPos.end.line, lineColumnPos.end.column)
    if (sessions[source]) {
      return sessions[source].addMarker(currentRange, cssClass)
    }
    return null
  }

  this.scrollToLine = function (line, center, animate, callback) {
    editor.scrollToLine(line, center, animate, callback)
  }

  this.removeMarker = function (markerId, source) {
    if (sessions[source]) {
      sessions[source].removeMarker(markerId)
    }
  }

  this.clearAnnotations = function () {
    sourceAnnotations = []
    editor.getSession().clearAnnotations()
  }

  this.addAnnotation = function (annotation) {
    sourceAnnotations[sourceAnnotations.length] = annotation
    this.setAnnotations(sourceAnnotations)
  }

  this.setAnnotations = function (sourceAnnotations) {
    editor.getSession().setAnnotations(sourceAnnotations)
  }

  this.gotoLine = function (line, col) {
    editor.focus()
    editor.gotoLine(line + 1, col - 1, true)
  }

  this.find = (string) => editor.find(string)

  this.previousInput = ''
  this.saveTimeout = null
  // Do setup on initialisation here
  editor.on('changeSession', function () {
    editorOnChange(self)
    event.trigger('sessionSwitched', [])

    editor.getSession().on('change', function () {
      editorOnChange(self)
      event.trigger('contentChanged', [])
    })
  })

  // Unmap ctrl-t & ctrl-f
  editor.commands.bindKeys({ 'ctrl-t': null })
  editor.setShowPrintMargin(false)
  editor.resize(true)
}

function editorOnChange (self) {
  var currentFile = self._deps.config.get('currentFile')
  if (!currentFile) {
    return
  }
  var input = self.get(currentFile)
  if (!input) {
    return
  }
  // if there's no change, don't do anything
  if (input === self.previousInput) {
    return
  }
  self.previousInput = input

  // fire storage update
  // NOTE: save at most once per 5 seconds
  if (self.saveTimeout) {
    window.clearTimeout(self.saveTimeout)
  }
  self.saveTimeout = window.setTimeout(() => {
    self._deps.fileManager.saveCurrentFile()
  }, 5000)
}

module.exports = Disass
