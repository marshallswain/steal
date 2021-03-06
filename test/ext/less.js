var css = require("$css");
var loader = require("@loader");
var lessEngine = require("@less-engine");

exports.instantiate = css.instantiate;

var options = loader.lessOptions || {};

// default optimization value.
options.optimization |= lessEngine.optimization;

exports.translate = function(load) {
	var address = load.address.replace(/^file\:/,"");

	var pathParts = (address+'').split('/');
	pathParts[pathParts.length - 1] = ''; // Remove filename

	if (typeof window !== 'undefined') {
		pathParts = (load.address+'').split('/');
		pathParts[pathParts.length - 1] = ''; // Remove filename
	}

	return new Promise(function(resolve, reject){
		var renderOptions = {
			filename: address,
			useFileCache: true
		};
		for (var prop in options){
			renderOptions[prop] = options[prop];
		}
		renderOptions.paths = (options.paths || []).concat(pathParts.join('/'));

		renderOptions.plugins = (options.plugins || []);
		if (stealLessPlugin !== undefined) {
			renderOptions.plugins.push(stealLessPlugin);
		}

		renderOptions.relativeUrls = options.relativeUrls === undefined ? true : options.relativeUrls;

		var done = function(output) {
			// Put the source map on metadata if one was created.
			load.metadata.map = output.map;
			resolve(output.css);
		};

		var fail = function(error) {
			reject(error);
		};

		lessEngine.render(load.source, renderOptions).then(done, fail);
	});
};
exports.locateScheme = true;
exports.buildType = "css";

// plugin to rewrite locate:// paths in imports
var stealLessPlugin = undefined;
if (lessEngine.FileManager) {
	var FileManager = lessEngine.FileManager;

	function StealLessManager() {
		this.PATTERN = /locate:\/\/([a-z0-9/._@-]*)/ig;
	}

	StealLessManager.prototype = new FileManager();

	StealLessManager.prototype.supports = function(filename) {
		return true;
	};

	StealLessManager.prototype.locate = function(filename, currentDirectory) {
		return Promise.resolve(loader.normalize(filename, currentDirectory))
			.then(function(name){
				return loader.locate({name: name, metadata: {}});
			});
	};

	StealLessManager.prototype.parseFile = function(file) {
		var self = this;
		var promises = [];
		// collect locate promises
		file.contents.replace(self.PATTERN, function (whole, path, index) {
			promises.push(self.locate(path, file.filename.replace(loader.baseURL, '')).then(function(filename) {
				return {
					str: filename.replace(file._directory, ''),
					loc: index,
					del: whole.length
				}
			}));
		});

		return Promise.all(promises).then(function(spliceDefs) {
			for(var i = spliceDefs.length; i--;) {
				var def = spliceDefs[i];
				file.contents = file.contents.slice(0, def.loc) + def.str + file.contents.slice(def.loc + def.del);
			}

			return file;
		});
	};

	StealLessManager.prototype.loadFile = function(filename, currentDirectory, options, environment, callback) {
		var self = this,
			_callback = callback,
			path = (currentDirectory + filename),
			directory = path.substring(0, path.lastIndexOf('/')+1),
			promise;

		callback = function(err, file) {
			file._directory = directory;

			self.parseFile(file).then(function(file) {
				_callback.call(self, null, file);
			});
		};

		promise = FileManager.prototype.loadFile.call(this, filename, currentDirectory, options, environment, callback);

		// when promise is returned we must wrap promise, when one is not, the wrapped callback is used
		if (promise && typeof promise.then == 'function') {
			return promise.then(function(file) {
				file._directory = directory;

				return self.parseFile(file);
			});
		}
	};

	stealLessPlugin = {
		install: function(less, pluginManager) {
			pluginManager.addFileManager(new StealLessManager());
		}
	};
}