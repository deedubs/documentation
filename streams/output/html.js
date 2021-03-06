'use strict';

var through = require('through'),
  File = require('vinyl'),
  vfs = require('vinyl-fs'),
  slugg = require('slugg'),
  Remarkable = require('remarkable'),
  fs = require('fs'),
  path = require('path'),
  Handlebars = require('handlebars'),
  extend = require('extend');

var BUILTINS = [
  'Array',
  'ArrayBuffer',
  'Boolean',
  'DataView',
  'Date',
  'Error',
  'EvalError',
  'Float32Array',
  'Float64Array',
  'Function',
  'Generator',
  'GeneratorFunction',
  'Infinity',
  'Int16Array',
  'Int32Array',
  'Int8Array',
  'InternalError',
  'Intl',
  'Intl.Collator',
  'Intl.DateTimeFormat',
  'Intl.NumberFormat',
  'Iterator',
  'JSON',
  'Map',
  'Math',
  'NaN',
  'Number',
  'Object',
  'ParallelArray',
  'Promise',
  'Proxy',
  'RangeError',
  'ReferenceError',
  'Reflect',
  'RegExp',
  'Set',
  'StopIteration',
  'String',
  'Symbol',
  'SyntaxError',
  'TypeError',
  'TypedArray',
  'URIError',
  'Uint16Array',
  'Uint32Array',
  'Uint8Array',
  'Uint8ClampedArray',
  'WeakMap',
  'WeakSet'
].reduce(function (memo, name) {
  memo[name.toLowerCase()] = name;
  return memo;
}, {});

/**
 * Create a transform stream that formats documentation as HTML.
 * Receives parsed & pivoted stream of documentation data, and emits
 * File objects representing different HTML files to be produced.
 *
 * @param {Object} opts Options that can customize the output
 * @param {String} [opts.template='../../share/markdown.hbs'] Path to a Handlebars template file that
 * takes the place of the default.
 * @name html
 * @return {stream.Transform}
 */
module.exports = function (opts) {

  var md = new Remarkable();

  var options = extend({}, {
    path: path.resolve(path.join(__dirname, '../../share/html/'))
  }, opts);

  /**
   * @name formatMarkdown
   *
   * This helper is exposed in templates as `md` and is useful for showing
   * Markdown-formatted text as proper HTML.
   * @param {String} string
   * @returns {String} string
   * @example
   * var x = '## foo';
   * // in template
   * // {{ md x }}
   * // generates <h2>foo</h2>
   */
  Handlebars.registerHelper('md', function formatMarkdown(string) {
    return md.render(string);
  });

  /**
   * Format a parameter name. This is used in formatParameters
   * and just needs to be careful about differentiating optional
   * parameters
   *
   * @param {Object} param
   * @returns {String} formatted parameter representation.
   */
  function formatParameter(param) {
    return (param.type && param.type.type === 'OptionalType') ?
      '[' + param.name + ']' : param.name;
  }

  /**
   * Format the parameters of a function into a quickly-readable
   * summary that resembles how you would call the function
   * initially.
   */
  function formatParameters() {
    if (!this.params) return '';
    return '(' + this.params.map(function (param) {
      return formatParameter(param);
    }).join(', ') + ')';
  }

  Handlebars.registerHelper('format_params', formatParameters);

  var pageTemplate = Handlebars
    .compile(fs.readFileSync(path.join(options.path, 'index.hbs'), 'utf8'));

  var sectionTemplate = Handlebars
    .compile(fs.readFileSync(path.join(options.path, 'section.hbs'), 'utf8'));

  Handlebars.registerPartial('section', sectionTemplate);

  return through(function (comments) {

    /**
     * @name formatType
     *
     * Helper used to format JSDoc-style type definitions into HTML.
     * @param {Object} type
     * @returns {String} string
     * @example
     * var x = { type: 'NameExpression', name: 'String' };
     * // in template
     * // {{ type x }}
     * // generates String
     */
    function formatType(type, html) {
      if (!type) return '';
      if (type.type === 'NameExpression') {
        return html ? '<code>' + autolink(type.name) + '</code>' : type.name;
      } else if (type.type === 'UnionType') {
        return type.elements.map(function (element) {
          return formatType(element, html);
        }).join(' or ');
      } else if (type.type === 'AllLiteral') {
        return 'Any';
      } else if (type.type === 'OptionalType') {
        return '<code>[' + formatType(type.expression, html) + ']</code>';
      } else if (type.type === 'TypeApplication') {
        return formatType(type.expression) + '<' +
          type.applications.map(function (application) {
            return formatType(application, html);
          }).join(', ') + '>';
      }
    }

    var paths = comments.map(function (comment) {
      return comment.path.map(slugg).join('/');
    }).filter(function (path) {
      return path;
    });

    Handlebars.registerHelper('format_type', function (string) {
      return formatType(string, true);
    });

    Handlebars.registerHelper('permalink', function () {
      return this.path.map(slugg).join('/');
    });

    /**
     * Link text to this page or to a central resource.
     * @param {string} text
     * @returns {string} potentially linked HTML
     */
    function autolink(text) {
      if (paths.indexOf(slugg(text)) !== -1) {
        return '<a href="#' + slugg(text) + '">' + text + '</a>';
      } else if (BUILTINS[text.toLowerCase()]) {
        return '<a href="https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/' + text + '">' + text + '</a>';
      }
      return text;
    }

    Handlebars.registerHelper('autolink', autolink);

    this.push(new File({
      path: 'index.json',
      contents: new Buffer(JSON.stringify(comments), 'utf8')
    }));

    this.push(new File({
      path: 'index.html',
      contents: new Buffer(pageTemplate({
        docs: comments,
        options: opts
      }), 'utf8')
    }));
  }, function () {
    // push assets into the pipeline as well.
    vfs.src([options.path + '/**', '!' + options.path + '/**.hbs'])
      .on('data', function (file) {
        this.push(file);
      }.bind(this))
      .on('end', function () {
        this.emit('end');
      }.bind(this));
  });
};
