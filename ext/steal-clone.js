// Recursively delete a module's parent modules
function deletedModulesParents(moduleName) {
	var parentModules = this.getDependants(moduleName);

	this['delete'](moduleName);

	for (var i = 0; i < parentModules.length; i++) {
		deletedModulesParents.call(this, parentModules[i]);
	}
}

// Returns a Promise that will resolve once the module is set on the loader
function setModule(moduleName, parentName, moduleOverrides) {
	var newLoader = this;
	return new Promise(function(resolve) {
		newLoader.normalize(moduleName, parentName)
		.then(function(normalizedModuleName) {
			deletedModulesParents.call(newLoader, normalizedModuleName);

			// set module overrides
			newLoader.set(normalizedModuleName, newLoader.newModule(
				moduleOverrides[moduleName]
			));
			resolve();
		});
	});
}

var excludedConfigProps = [ '_extensions', '_loader' ];
// Recursively copy a config object
function cloneConfig(obj, isTopLevel) {
	var clone;

	if (obj == null || typeof obj !== "object" || obj['isCloned']) {
		return obj;
	}

	if (obj instanceof Array) {
		clone = [];
		for (var i = 0, len = obj.length; i < len; i++) {
			clone[i] = cloneConfig(obj[i]);
		}
		return clone;
	}

	if (obj instanceof Object) {
		clone = {};
		for (var attr in obj) {
			obj['isCloned'] = true; // prevent infinite recursion
			if (obj.hasOwnProperty(attr)) {
				if (isTopLevel) {
					// exclude specific props and functions from top-level of config
					if (typeof obj[attr] !== 'function' && excludedConfigProps.indexOf(attr) < 0) {
						clone[attr] = cloneConfig(obj[attr]);
					}
				} else {
					clone[attr] = cloneConfig(obj[attr]);
				}
			}
			delete obj['isCloned'];
		}
		return clone;
	}

	throw new Error("Unable to copy obj! Its type isn't supported.");
}

module.exports = function(parentName) {
	var loader = this;
	return {
		'default': function clone(moduleOverrides) {
			var newLoader = loader.clone();

			// prevent import from being called before module overrides are complete
			var _import = newLoader['import'];
			newLoader['import'] = function() {
				var args = arguments;
				if(this._overridePromises) {
					// call import once all module overrides are complete
					return Promise.all(this._overridePromises).then(function(){
						delete newLoader._overridePromises;
						// ensure parentName is set on import calls
						return _import.call(newLoader, args[0], { name: parentName });
					});
				}
				// ensure parentName is set on import calls
				return _import.call(this, args[0], { name: parentName });
			};

			var _fetch = newLoader.fetch;
			newLoader.fetch = function() {
				var name = arguments[0].name;
				var cached = newLoader._traceData.loads[name];
				if (cached) {
					return Promise.resolve(cached.source);
				}
				return _fetch.apply(this, arguments);
			};

			// copy module config
			var newConfig = cloneConfig(loader, true);
			newLoader.config(newConfig);
			if (newLoader.npmContext) {
				newLoader.npmContext.loader = newLoader;
			}

			// copy module registry
			loader.eachModule(function(moduleName, moduleData) {
				newLoader.set(moduleName, moduleData);
			});

			// set module overrides
			if (moduleOverrides) {
				newLoader._overridePromises = [];
				for (var moduleOverrideName in moduleOverrides) {
					newLoader._overridePromises.push(
						setModule.call(newLoader, moduleOverrideName, parentName, moduleOverrides)
					);
				}
			}

			return newLoader;
		},
		__useDefault: true
	};
};
