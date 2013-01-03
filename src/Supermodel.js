
/*global module, define */

(function ( global ) {

	'use strict';

	var Supermodel,

	// Helper functions
	dispatchQueue,
	splitKeypath,
	parseArrayNotation,
	standardise,
	isEqual,
	indexOf,

	// Cached regexes
	integerPattern = /^[0-9]+$/,
	arrayNotationPattern = /\[([0-9]+)\]/;



	// Constructor
	// -----------
	Supermodel = function ( data ) {
		this._data = data || {};
		this._observers = {};
		this._computed = {};
		this._queue = [];
	};


	// Prototype
	// ---------
	Supermodel.prototype = {
		
		// Set item on our model. Can be deeper than the top layer, e.g.
		// `model.set( 'foo.bar', 'baz' )`.
		//
		// Branches in the model tree will be created as necessary (as
		// arrays if appropriate, e.g.
		//
		//     model.set( 'foo.bar[0]', 'baz' )
		//     => { foo: { bar: [ 'baz' ] } }
		//
		// Observers are notified if the value changes unless `silent = true`.
		// Set `force = true` to notify observers even if no change occurs
		// (will do nothing if `silent === true`).
		//
		// Setting an item will also notify observers of up/downstream keypaths
		// e.g. an observer of `'foo.bar'` will be notified when `'foo'` changes
		// (provided the `'bar'` property changes as a result), and vice versa.
		// `silent` and `force` still apply.
		set: function ( keypath, value, silent, force ) {
			var k, keys, key, obj, i, branch, previous, computed;

			// Multiple items can be set in one go:
			//
			//     model.set({
			//       one: 1,
			//       two: 2,
			//       three: 3
			//     }, true );	// sets all three items silently
			if ( typeof keypath === 'object' ) {
				
				// We don't want to dispatch callbacks straight away, as observers of
				// computed values with multiple changed triggers will be notified
				// multiple times. Instead, we queue the callbacks - later, they will
				// be de-duped and dispatched.
				this.queueing = true;

				silent = value;
				for ( k in keypath ) {
					if ( keypath.hasOwnProperty( k ) ) {
						this.set( k, keypath[k], silent );
					}
				}

				dispatchQueue( this._queue );
				this.queueing = false;

				return this;
			}

			// Determine whether we're dealing with a computed value
			computed = this._computed[ keypath ];
			if ( computed ) {
				
				// Determine whether `.set()` was called 'manually', or by
				// the computed value's observer
				if ( !this.computing ) {
					
					// `.set()` was called manually - if the value is readonly,
					// throw an error.
					if ( computed.readonly ) {
						throw 'The computed value "' + keypath + '" has readonly set true and cannot be changed manually';
					}

					// Flag the value as overridden so that `.get()` returns the
					// correct value...
					computed.override = true;
				} else {

					// until the next time the value is computed.
					computed.override = false;
					this.computing = false;
				}
			}

			// Store previous value
			this._referToCache = true;
			previous = this.get( keypath );
			this._referToCache = false;

			// Split keypath (`'foo.bar.baz[0]'`) into keys (`['foo','bar','baz',0]`)
			keys = splitKeypath( keypath );

			// Standardise keypath (without calling `standardise()`, since
			// half the work is already done)
			keypath = keys.join( '.' );

			obj = this._data;
			while ( keys.length > 1 ) {
				key = keys.shift();

				// Proceed down the tree. If we need to create a new branch, determine
				// if it is a hash or an array
				if ( !obj[ key ] ) {
					
					// If there is a numeric key following this one, create an array
					if ( keys[0] === parseInt( keys[0], 10 ) || integerPattern.test( keys[0] ) ) {
						obj[ key ] = [];
					}

					// Otherwise create a hash
					else {
						obj[ key ] = {};
					}
				}

				// Step down, then lather/rinse/repeat
				obj = obj[ key ];
			}

			key = keys[0];

			// Set the value
			obj[ key ] = value;

			// If `silent === false`, and either `force` is true or the new value
			// is different to the old value, notify observers
			if ( !silent && ( force || !isEqual( previous, value ) ) ) {
				this._notifyObservers( keypath, value, force );
			}

			return this;
		},

		// Get item from our model. Again, can be arbitrarily deep, e.g.
		// `model.get( 'foo.bar.baz[0]' )`
		get: function ( keypath ) {
			var keys, result, computed, value;

			if ( !keypath ) {
				return undefined;
			}

			// if we have a computed value with this ID, get it, unless we specifically
			// want the cached value
			if ( !this._referToCache ) {
				computed = this._computed[ keypath ];
				if ( computed && !computed.cache && !computed.override ) {
					computed.setter(); // call setter, update data silently
				}
			}

			keys = splitKeypath( keypath );

			result = this._data;
			while ( keys.length ) {
				try {
					result = result[ keys.shift() ];
				} catch ( err ) {
					return undefined;
				}
				
				if ( result === undefined ) {
					return undefined;
				}
			}

			return result;
		},

		// Register a function to be called when the model changes, including
		// as a result of up/downstream changes
		//
		// e.g.
		//
		//     model.observe( 'foo.bar', function ( newValue, oldValue ) {
		//       alert( newValue );
		//     });
		//
		//     model.set( 'foo', { bar: 'baz' } ); // alerts 'baz'
		//
		// Returns an array of observers which must be used with
		// `model.unobserve()`. The length of said array is determined
		// by the depth of the observed keypath, e.g. `'foo'` returns a
		// single observer, `'foo.bar.baz[0]'` returns four - one for
		// the keypath itself, one for the three upstream branches
		observe: function ( keypath, callback, initialize ) {
			
			var self = this,
				originalKeypath,
				observerGroup = [],
				observe;

			if ( !keypath ) {
				return undefined;
			}

			// Standardise (`'foo[0]'`' => `'foo.0'`) and store keypath (for when we
			// observe upstream keypaths)
			originalKeypath = keypath = standardise( keypath );

			observe = function ( keypath ) {
				var observers, observer;

				observers = self._observers[ keypath ] = ( self._observers[ keypath ] || [] );

				observer = {
					observedKeypath: keypath,
					originalKeypath: originalKeypath,
					callback: callback,
					group: observerGroup
				};

				observers[ observers.length ] = observer;
				observerGroup[ observerGroup.length ] = observer;
			};

			while ( keypath.lastIndexOf( '.' ) !== -1 ) {
				observe( keypath );

				// Remove the last item in the keypath so we can observe
				// upstream keypaths
				keypath = keypath.substr( 0, keypath.lastIndexOf( '.' ) );
			}

			observe( keypath );

			if ( initialize ) {
				callback( this.get( originalKeypath ) );
			}

			observerGroup.__previousValue = self.get( originalKeypath );

			return observerGroup;
		},

		observeOnce: function ( keypath, callback ) {
			var self = this, suicidalObservers;

			suicidalObservers = this.observe( keypath, function ( value, previousValue ) {
				callback( value, previousValue );
				self.unobserve( suicidalObservers );
			});

			return this;
		},

		// Cancel observer(s)
		unobserve: function ( observerToCancel ) {
			var observers, index, keypath;

			// Allow a single observer, or an array
			if ( observerToCancel.hasOwnProperty( 'length' ) ) {
				while ( observerToCancel.length ) {
					this.unobserve( observerToCancel.shift() );
				}
				return;
			}

			keypath = standardise( observerToCancel.observedKeypath );

			observers = this._observers[ keypath ];
			if ( !observers ) {
				// Nothing to unobserve
				return;
			}

			index = observers.indexOf( observerToCancel );

			if ( index === -1 ) {
				// Nothing to unobserve
				return;
			}

			// Remove the observer from the list...
			observers.splice( index, 1 );

			// ...then tidy up if necessary
			if ( observers.length === 0 ) {
				delete this._observers[ keypath ];
			}

			return this;
		},

		// Create a computed value
		compute: function ( id, options ) {
			var self = this, i, getter, setter, triggers, fn, cache, readonly, value, observerGroups, computed;

			// Allow multiple values to be set in one go
			if ( typeof id === 'object' ) {
				
				// We'll just use the `computed` variable, since it was lying
				// around and won't be needed elsewhere
				computed = {};

				// Ditto i
				for ( i in id ) {
					if ( id.hasOwnProperty( i ) ) {
						computed[ i ] = this.compute( i, id[ i ] );
					}
				}

				return computed;
			}

			// If a computed value with this id already exists, remove it
			if ( this._computed[ id ] ) {
				this.removeComputedValue( id );
			}

			fn = options.fn;
			triggers = options.triggers || options.trigger;
			
			// Ensure triggers is an array
			if ( !triggers ) {
				triggers = [];
			}

			if ( typeof triggers === 'string' ) {
				triggers = [ triggers ];
			}

			// Throw an error if `id` is in `triggers`
			if ( indexOf( id, triggers ) !== -1 ) {
				throw 'A computed value cannot be its own trigger';
			}

			// If there are triggers, default `cache` to `true`. If not, set it to `false`
			if ( triggers.length ) {
				cache = ( options.cache === false ? false : true );
			} else {
				cache = false;
			}

			// Default to readonly
			readonly = ( options.readonly === false ? false : true );


			// Keep a reference to the observers, so we can remove this
			// computed value later if needs be
			observerGroups = [];

			
			// Create getter function. This is a wrapper for `fn`, which passes
			// it the current values of any triggers that have been defined
			getter = function () {
				var i, args = [];

				i = triggers.length;
				while ( i-- ) {
					args[i] = self.get( triggers[i] );
				}

				value = options.fn.apply( self, args );
				return value;
			};

			// Create setter function. This sets the `id` keypath to the value
			// returned from `getter`.
			setter = function () {
				computed.cache = true; // Prevent infinite loops by temporarily caching this value
				self.computing = true;
				self.set( id, getter() );
				computed.cache = cache; // Return to normal behaviour
			};

			// Store reference to this computed value
			computed = this._computed[ id ] = {
				getter: getter,
				setter: setter,
				cache: cache || false,
				readonly: readonly,
				observerGroups: observerGroups
			};

			// Call our setter, to initialise the value
			setter();

			// watch our triggers
			i = triggers.length;

			// if there are no triggers, `cache` must be false, otherwise
			// the value will never change
			if ( !i && cache ) {
				throw 'Cached computed values must have at least one trigger';
			}

			while ( i-- ) {
				observerGroups[ observerGroups.length ] = this.observe( triggers[i], setter );
			}

			return value;
		},

		removeComputedValue: function ( id ) {
			var observerGroups = this._computed[ id ].observerGroups;

			while ( observerGroups.length ) {
				this.unobserve( observerGroups.pop() );
			}

			delete this._computed[ id ];
		},

		// Internal publish method
		_notifyObservers: function ( keypath, value, force ) {
			var self = this, observers = this._observers[ keypath ] || [], i, observer, actualValue, previousValue;

			// Notify observers of this keypath, and any downstream keypaths
			for ( i=0; i<observers.length; i+=1 ) {
				observer = observers[i];

				previousValue = observer.group.__previousValue;
				
				if ( keypath !== observer.originalKeypath ) {
					actualValue = self.get( observer.originalKeypath );
				} else {
					actualValue = value;
				}

				observer.group.__previousValue = actualValue;
				
				// If this value hasn't changed, skip the callback, unless `force === true`
				if ( !force && isEqual( actualValue, previousValue ) ) {
					continue;
				}

				// If we are queueing callbacks, add this to the queue, otherwise fire immediately
				if ( this.queueing ) {
					this._addToQueue( observer.callback, actualValue, previousValue );
				} else {
					observer.callback( actualValue, previousValue );
				}
			}

			// Notify upstream observers
			while ( keypath.lastIndexOf( '.' ) !== -1 ) {
				keypath = keypath.substr( 0, keypath.lastIndexOf( '.' ) );

				observers = this._observers[ keypath ];

				if ( !observers ) {
					continue;
				}

				i = observers.length;
				while ( i-- ) {
					observer = observers[i];
					if ( observer.observedKeypath === observer.originalKeypath ) {
						value = this.get( keypath );

						// See above - add to the queue, or fire immediately
						if ( this.queueing ) {
							
							// Since we're dealing with an object rather than a primitive (by
							// definition, as this is an upstream observer), there is no
							// distinction between the previous value and the current one -
							// it is the same object, even if its contents have changed. That's
							// why the next line looks a bit weird.
							this._addToQueue( observer.callback, value, value );
						} else {
							observer.callback( value, value );
						}
					}
				}
			}
		},

		_addToQueue: function ( callback, value, previous ) {
			var i;

			// Remove queued item with this callback, if there is one
			for ( i=0; i<this._queue.length; i+=1 ) {
				if ( this._queue[i].c === callback ) {
					this._queue.splice( i, 1 );
					break;
				}
			}

			// Append a new item
			this._queue[ this._queue.length ] = {
				c: callback,
				v: value,
				p: previous
			};
		}
	};


	// Helper functions
	// ----------------

	// De-dupe callbacks, then fire
	dispatchQueue = function ( queue ) {
		var item;

		// Call each callback with the current and previous value
		while ( queue.length ) {
			item = queue.shift();
			item.c( item.v, item.p );
		}
	};

	// turn `'foo.bar.baz'` into `['foo','bar','baz']`
	splitKeypath = function ( keypath ) {
		var firstPass, secondPass = [], numKeys, key, i, startIndex, pattern, match;

		// Start by splitting on periods
		firstPass = keypath.split( '.' );

		// Then see if any keys use array notation instead of dot notation
		for ( i=0; i<firstPass.length; i+=1 ) {
			secondPass = secondPass.concat( parseArrayNotation( firstPass[i] ) );
		}

		return secondPass;
	};

	// Split key with array notation (`'baz[0]'`) into identifier
	// and array pointer(s) (`['baz',0]`)
	parseArrayNotation = function ( key ) {
		var index, arrayPointers, match, result;

		index = key.indexOf( '[' );

		if ( index === -1 ) {
			return key;
		}

		result = [ key.substr( 0, index ) ];
		arrayPointers = key.substring( index );

		while ( arrayPointers.length ) {
			match = arrayNotationPattern.exec( arrayPointers );

			if ( !match ) {
				return result;
			}

			result[ result.length ] = +match[1];
			arrayPointers = arrayPointers.substring( match[0].length );
		}

		return result;
	};

	// turn `'foo.bar.baz[0]'` into `'foo.bar.baz.0'`
	standardise = function ( keypath ) {
		return splitKeypath( keypath ).join( '.' );
	};

	isEqual = function ( a, b ) {
		
		// workaround for null...
		if ( a === null && b === null ) {
			return true;
		}

		// If a or b is an object, return false. Otherwise `set( key, value )` will fail to notify
		// observers of `key` if `value` is the same object or array as it was before, even though
		// the contents of changed
		if ( typeof a === 'object' || typeof b === 'object' ) {
			return false;
		}

		// we're left with a primitive
		return a === b;
	};

	indexOf = function ( needle, haystack ) {
		var i;

		if ( haystack.indexOf ) {
			return haystack.indexOf( needle );
		}

		// IE, you bastard
		for ( i=0; i<haystack.length; i+=1 ) {
			if ( haystack[i] === needle ) {
				return i;
			}
		}

		return -1;
	};

	

	// CommonJS - add to exports
	if ( typeof module !== 'undefined' && module.exports ) {
		module.exports = Supermodel;
	}

	// AMD - define module
	else if ( typeof define === 'function' && define.amd ) {
		define( function () {
			return Supermodel;
		});
	}

	// Browsers - create global variable
	else {
		global.Supermodel = Supermodel;
	}
	

}( this ));