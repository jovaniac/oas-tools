/*!
OAS-tools module 0.0.0, built on: 2017-03-30
Copyright (C) 2017 Ignacio Peluaga Lozada (ISA Group)
https://github.com/ignpelloz
https://github.com/isa-group/project-oas-tools

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.*/
'use strict';

var exports;
var path = require('path');
var ZSchema = require("z-schema");
var logger = require('../logger/logger');
var validator = new ZSchema({
  ignoreUnresolvableReferences: true,
  ignoreUnknownFormats: true
});

var controllers;

/**
 * Executes a function whose name is stored in a string value
 * @param {string} functionName - Name of the function to be executed.
 * @param {string} context - Location of the function to be executed.
 * @param {string} req - Request object (necessary for the execution of the controller).
 * @param {string} res - Response object (necessary for the execution of the controller).
 * @param {string} next - Express middleware next function (necessary for the execution of the controller).
 */
function executeFunctionByName(functionName, context, req, res, next) {
  var args = Array.prototype.slice.call(arguments, 3);
  var namespaces = functionName.split(".");
  var func = namespaces.pop();
  for (var i = 0; i < namespaces.length; i++) {
    context = context[namespaces[i]];
  }
  return context[func].apply(context, [req, res, next]);
}

/**
 * Returns a string containing all the error messages
 * @param {object} err - Error object generated by the validator after a wrong validation
 */
function processErr(err){
  var errors = "";
  for(var i = 0; i<err.length; i++){
    errors = errors + ". " + err[i].message;
  }
  return errors.substring(2,errors.length);
}

/**
 * Checks if the data sent as a response for the previous request matches the indicated in the specification file in the responses section for that request.
 * This function is used in the interception of the response sent by the controller to the client that made the request.
 * @param {object} code - Status code sent from the controller to the client.
 * @param {object} spec - Specification file.
 * @param {object} method - Method requested by the client.
 * @param {object} url - Requested path.
 * @param {object} data - Data sent from controller to client.
 */
function checkResponse(code, spec, method, url, data) {
  data = data[0];
  logger.info("Processing at checkResponse:");
  logger.info("  -code: " + code);
  logger.info("  -spec: " + spec);
  logger.info("  -method: " + method);
  logger.info("  -url: " + url);
  logger.info("  -data: " + data);
  var responseCodeSection = spec.paths[url][method].responses[code]; //Section of the spec file starting at a response code
  if (responseCodeSection == undefined) {
    logger.info("WARNING: wrong response code");
    logger.info(code);
  } else { //if the code is undefined, data wont be checked as a status code is needed to retrieve 'schema' from the spec file
    if (responseCodeSection.hasOwnProperty('content')) { //if there is no content property for the given response then there is nothing to validate.
      var validSchema = responseCodeSection.content['application/json'].schema;
      logger.info("schema to use for validation");
      logger.info(validSchema);
      var data = JSON.parse(data); //Without this everything is string so type validation wouldn't happen
      validator.validate(data, validSchema, function(err, valid) {
        if (err) {
          logger.info("WARNING: wrong data in the response. " + processErr(err));
          logger.info(data);
        }
      });
    }
  }
}

/**
 * Checks whether there is a standard controller (resouce+Controlle) in the location where the controllers are located or not.
 * @param {object} locationOfControllers - Location provided by the user where the controllers can be found.
 * @param {object} controllerName - Name of the controller: resource+Controller.
 */
function existsController(locationOfControllers, controllerName) {
  var load = require(path.join(locationOfControllers, controllerName));
  if (load == undefined) {
    return false;
  } else {
    return true;
  }
}

/**
 * Removes '/' from the requested url and returns a string representing the name (path) of the requested resource
 * @param {object} reqPath - Path containing '/' at the beggining.
 */
function nameOfPath(reqPath) {
  return reqPath.toString().substring(1, reqPath.length).toString();
}

/**
 * Removes '/' from the requested url and generates the standard name for controller: nameOfResource + "Controller"
 * @param {object} url - Url requested by the user, without parameters
 */
function generateName(url) {
  return nameOfPath(url) + "Controllers";
}

/**
 * Returns a simple, frinedly, intuitive name deppending on the requested method.
 * @param {object} method - method name taken directly from the req object.
 */
function nameMethod(method) {
  method = method.toString();
  var name;
  if (method == 'GET') {
    name = "list";
  } else if (method == 'POST') {
    name = "create";
  } else if (method == 'PUT') {
    name = "update";
  } else {
    name = "delete";
  }
  return name;
}

/**
 * Returns an operationId. The retrieved one from the specification file or an automatic generated one if it was not specified.
 * @param {object} spec - specification file
 * @param {object} url - requested url
 * @param {object} method - requested method
 */
function generateOpId(spec,url,method){
  if (spec.paths[url][method].hasOwnProperty('operationId')) {
    return spec.paths[url][method].operationId.toString(); // Use opID specified in the oas doc
  } else {
    return nameMethod(spec.paths[url][method]) + nameOfPath(spec.paths[url][method]); //if there is no opID in the spec, then generate the identifier
  }
}

exports = module.exports = function(options) {
  logger.info("Controller initialized at: " + options.controllers);
  return function OASRouter(req, res, next) {
    var spec = res.locals.spec;
    var url = res.locals.requestedUlr;
    var method = req.method.toLowerCase();

    if (spec.paths[url][method].hasOwnProperty('x-router-controller')) { //spec file has x-router-controllers property: use the controller specified there
      var controllerName = spec.paths[url][method]['x-router-controller'];
    } else if (existsController(options.controllers, generateName(url))) { //spec file doesn't have x-router-controllers property: use the standard controller name (autogenerated) if finded
      var controllerName = generateName(url);
    } else { //spec file doesn't have x-router-controllers property and standard controller (autogenerated name) doesn't exist: use the default controller
      var controllerName = "Defualt";
    }

    var opID = generateOpId(spec,url,method);
    var controller = require(path.join(options.controllers, controllerName));

    var oldSend = res.send;
    res.send = function(data) { //intercept the response from the controller to check and validate it
      arguments[0] = JSON.stringify(arguments[0]); //Avoids res.send being executed twice: https://stackoverflow.com/questions/41489528/why-is-res-send-being-called-twice
      checkResponse(res.statusCode, spec, method, url, arguments);
      oldSend.apply(res, arguments);
    }
    executeFunctionByName(opID, controller, req, res, next);
  }
}
