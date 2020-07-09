/* eslint-env jest */

import EventEmitter from 'events';
import BrowserSyncWebpackPlugin from '../src/BrowserSyncWebpackPlugin';

const noop = jest.fn();
const nodeCallback = function() {
	const args = Array.from(arguments);
	const fn = args[args.length - 1];
	fn.apply(fn);
};
const mockCompiler = () =>
	new class {
		constructor() {
			this.plugin = nodeCallback;
			this.options = {};
		}
	}();
const mockBrowserSync = () =>
	new class {
		constructor() {
			this.notify = noop;
			this.use = noop;
			this.emitter = new EventEmitter();
		}
		init(config) {
			this.emitter.emit('init', this, config);
		}
	}();

describe('BrowserSyncWebpackPlugin', () => {
	test('should exit early if options.disable is true', () => {
		const test = new BrowserSyncWebpackPlugin(
			{ disable: true },
			{}
		);
		test.apply({});
		expect(test.compiler).toBe(null);
	});
	describe('Events', () => {
		const makePluginInstance = config => {
			const plugin = new BrowserSyncWebpackPlugin(
				config,
				mockBrowserSync()
			);
			// Let's not deal with the middleware
			plugin.setupWebpackDevMiddleware = plugin.setupWebpackHotMiddleware = noop; // eslint-disable-line no-multi-assign
			return plugin;
		};

		// test('fire a setup event', done => {
		// 	return makePluginInstance({
		// 		events: {
		// 			setup() {
		// 				done();
		// 			},
		// 		},
		// 	}).apply(mockCompiler());
		// });
		// test('fire a ready event', done => {
		// 	return makePluginInstance({
		// 		delay: 1, // No need for delay
		// 		events: {
		// 			ready() {
		// 				done();
		// 			},
		// 		},
		// 	}).apply(mockCompiler());
		// });
	});
});
