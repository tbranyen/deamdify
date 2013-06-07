var through = require('through')
  , esprima = require('esprima')
  , estraverse = require('estraverse')
  , escodegen = require('escodegen')
  , util = require('util');


module.exports = function (file) {
  var data = '';
  
  var stream = through(write, end);
  return stream;
  
  function write(buf) { data += buf }
  function end() {
    var ast = esprima.parse(data)
      , tast;
    
    console.log('-- ORIGINAL AST --');
    console.log(util.inspect(ast, false, null));
    console.log('------------------');
    
    // TODO: Ensure that define is a top-level function call.
    
    estraverse.replace(ast, {
      leave: function(node) {
        if (isDefine(node)) {
          if (node.arguments.length == 1 && node.arguments[0].type == 'FunctionExpression') {
            var factory = node.arguments[0];
            
            if (factory.params.length == 0) {
              tast = createProgram(factory.body.body);
              this.break();
            } else if (factory.params.length > 0) {
              // simplified CommonJS wrapper
              tast = createProgram(factory.body.body);
              this.break();
            }
          } else if (node.arguments.length == 1 && node.arguments[0].type == 'ObjectExpression') {
            // object literal
            var obj = node.arguments[0];
            
            tast = createModuleExport(obj);
            this.break();
          } else if (node.arguments.length == 2 && node.arguments[0].type == 'ArrayExpression' && node.arguments[1].type == 'FunctionExpression') {
            var dependencies = node.arguments[0]
              , factory = node.arguments[1];
            
            var ids = dependencies.elements.map(function(el) { return el.value });
            var vars = factory.params.map(function(el) { return el.name });
            var reqs = createRequires(ids, vars);
            tast = createProgram([reqs].concat(factory.body.body));
            this.break();
          } else if (node.arguments.length == 3 && node.arguments[0].type == 'Literal' && node.arguments[1].type == 'ArrayExpression' && node.arguments[2].type == 'FunctionExpression') {
            var dependencies = node.arguments[1]
              , factory = node.arguments[2];
            
            var ids = dependencies.elements.map(function(el) { return el.value });
            var vars = factory.params.map(function(el) { return el.name });
            var reqs = createRequires(ids, vars);
            tast = createProgram([reqs].concat(factory.body.body));
            this.break();
          }
        } else if (isReturn(node)) {
          var parents = this.parents();
          
          if (parents.length == 5 && isDefine(parents[2])) {
            return createModuleExport(node.argument);
          }
        }
      }
    });
    
    tast = tast || ast;
    
    console.log('-- TRANSFORMED AST --');
    console.log(util.inspect(tast, false, null));
    console.log('---------------------');
    
    var out = escodegen.generate(tast);
    stream.queue(out);
    stream.queue(null);
  }
};


function isDefine(node) {
  var callee = node.callee;
  return callee
    && node.type == 'CallExpression'
    && callee.type == 'Identifier'
    && callee.name == 'define'
  ;
}

function isReturn(node) {
  return node.type == 'ReturnStatement';
}

function createProgram(body) {
  return { type: 'Program',
    body: body };
}

function createRequires(ids, vars) {
  var decls = [];
  
  for (var i = 0, len = ids.length; i < len; ++i) {
    decls.push({ type: 'VariableDeclarator',
      id: { type: 'Identifier', name: vars[i] },
      init: 
        { type: 'CallExpression',
          callee: { type: 'Identifier', name: 'require' },
          arguments: [ { type: 'Literal', value: ids[i] } ] } });
  }
  
  return { type: 'VariableDeclaration',
    declarations: decls,
    kind: 'var' };
}

function createModuleExport(obj) {
  return { type: 'ExpressionStatement',
    expression: 
     { type: 'AssignmentExpression',
       operator: '=',
       left: 
        { type: 'MemberExpression',
          computed: false,
          object: { type: 'Identifier', name: 'module' },
          property: { type: 'Identifier', name: 'exports' } },
       right: obj } };
}
