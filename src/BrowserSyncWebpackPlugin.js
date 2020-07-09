const EventEmitter = require('events');
const url = require('url');
const debuglog = require('util').debuglog('BrowserSyncWebpackPlugin');

const browserSync = require('browser-sync');
const merge = require('webpack-merge');

const { desire, uniq } = require('./util');
const sysPath = require('path');

const htmlInjector = desire('bs-html-injector');

let webpackDevMiddleware = desire('webpack-dev-middleware');
if (webpackDevMiddleware) {
	webpackDevMiddleware =
		webpackDevMiddleware.default || webpackDevMiddleware;
}

const webpackHotMiddleware = desire('webpack-hot-middleware');

function urlencodePath(filePath) {
	return filePath.split('/').map(encodeURIComponent).join('/');
}

function appendHash(url, hash) {
	if (!url) {
		return url;
	}
	return url + (url.indexOf('?') === -1 ? '?' : '&') + hash;
}

function isAssetPresent(html, src) {
	let pattern;
	if (/\.js(\?.*)?$/.test(src)) {
		pattern = new RegExp(`\\s+src=['"][^'"]+${src}['"]"`, 'g');
	}

	if (/\.css$/.test(src)) {
		pattern = new RegExp(`\\s+href=['"][^'"]+${src}['"]`, 'g');
	}

	return pattern && pattern.test(html);
}

function assetTag(src) {
	if (/\.js$/.test(src)) {
		return `<script src="${src}"></script>`;
	}

	if (/\.css$/.test(src)) {
		return `<link rel="stylesheet" href="${src}">`;
	}

	return '';
}

/**
 * BrowserSyncWebpackPlugin
 * Combines BrowserSync, webpack-dev-middleware, and webpack-hot-middleware into one ezpz plugin.
 *
 * @class BrowserSyncWebpackPlugin
 */
module.exports = class BrowserSyncWebpackPlugin extends EventEmitter {
	/**
	 * Creates an instance of BrowserSyncWebpackPlugin.
	 * @param {object} options
	 */
	constructor(options, watcher = browserSync.create()) {
		super();
		this.pluginName = 'BrowserSyncWebpackPlugin';
		this.open = true;
		this.compiler = null;
		this.middleware = [];
		this.ready = false;
		this.resolvers = [];
		this.watcher = watcher;
		this.watcherConfig = {};
		this.runtimePublicPath = null;
		this.webpackAssetUrls = [];
		this.options = merge(
			{
				proxyUrl: 'https://localhost:3000',
				watch: [],
				sync: true,
				delay: 50,
				debounce: 0,
				events: {
					setup() {},
					ready() {},
					update() {},
					add() {},
					change() {},
					unlink() {},
				},
				advanced: {
					browserSync: {},
					webpackDevMiddleware: {},
					webpackHotMiddleware: {},
					injectorRequestOptions: {},
				},
			},
			options
		);
	}

	/**
	 * Registers all events
	 * @private
	 */
	registerEvents() {
		Object.keys(this.options.events).forEach(event => {
			this.on(
				event,
				debuglog.bind(debuglog, `Event: ${event}`)
			);
			this.on(event, this.options.events[event]);
		});

		this.on('webpack.compilation', () =>
			this.watcher.notify('Rebuilding...')
		);

		this.on('ready', () => {
			this.ready = true;
		});
	}

	/**
	 * Attaches events to Compiler object
	 * This is called directly by Webpack
	 *
	 * @param {Compiler} compiler
	 * @returns void
	 */
	apply(compiler) {
		if (this.options.disable) {
			return;
		}
		this.registerEvents();
		this.compiler = compiler;
		const pluginName = this.pluginName;

		if (compiler.hooks) {
			compiler.hooks.done.tapAsync(
				pluginName,
				({ compilation }, callback) => {
					const assets = Array.from(
						compilation.assetsInfo.keys()
					);

					let {
						publicPath,
					} = compilation.outputOptions;
					if (
						publicPath &&
						publicPath.substring(
							publicPath.length - 1
						) !== '/'
					) {
						publicPath += '/';
					}

					this.webpackAssetUrls.push(
						...assets
							.filter(asset =>
								[
									'hmr.js',
									'runtime.js',
								].includes(
									sysPath.basename(
										asset
									)
								)
							)
							.map(
								asset =>
									`${publicPath}${asset}`
							)
					);

					callback();
				}
			);

			compiler.hooks.compilation.tap(
				pluginName,
				this.emit.bind(
					this,
					'webpack.compilation',
					this
				)
			);

			compiler.hooks.emit.tapAsync(
				pluginName,
				(compilation, callback) => {
					const compilationHash =
						compilation.hash;
					let publicPath = compilation.mainTemplate.getPublicPath(
						{ hash: compilationHash }
					);
					if (
						publicPath.length &&
						publicPath.substr(-1, 1) !== '/'
					) {
						publicPath += '/';
					}

					const entries = Array.from(
						compilation.entrypoints.keys()
					);

					for (
						let i = 0;
						i < entries.length;
						i++
					) {
						const entryName = entries[i];
						const entryPointFiles = compilation.entrypoints
							.get(entryName)
							.getFiles();

						const entryPointPublicPaths = entryPointFiles.map(
							chunkFile => {
								const entryPointPublicPath =
									publicPath +
									urlencodePath(
										chunkFile
									);

								return this
									.options
									.hash
									? appendHash(
											entryPointPublicPath,
											compilationHash
										)
									: entryPointPublicPath;
							}
						);
					}

					callback();
				}
			);
		} else {
			compiler.plugin(
				'done',
				this.emit.bind(this, 'webpack.done', this)
			);
			compiler.plugin(
				'compilation',
				this.emit.bind(
					this,
					'webpack.compilation',
					this
				)
			);
		}
	}

	/**
	 * Start BrowserSync server.
	 * @private
	 */
	start() {
		this.setup();
		this.watcher.emitter.on(
			'init',
			this.emit.bind(this, 'ready', this, this.watcher)
		);

		this.watcher.emitter.on(
			'file:changed',
			(event, file, stats) => {
				this.emit('update', this, file, stats, event);
				this.emit(event, this, file, stats);
			}
		);

		this.watcher.init(this.watcherConfig);
	}

	/**
	 * Setup BrowserSync config.
	 * @private
	 */
	setup() {
		if (this.useHtmlInjector() && this.options.watch) {
			this.watcher.use(htmlInjector, {
				files: Array.isArray(this.options.watch)
					? uniq(this.options.watch)
					: [this.options.watch],
				/**
				 * This option does nothing at the moment.
				 * I'm awaiting feedback on a PR.
				 *
				 * @link https://github.com/shakyShane/html-injector/pull/29
				 *
				 * In the meantime either don't use SSL or set the following
				 * super insecure setting:
				 *   process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;
				 */
				requestOptions: Object.assign(
					{
						agentOptions: {
							rejectUnauthorized: false,
						},
					},
					this.options.advanced
						.injectorRequestOptions
				),
			});
		}

		if (webpackDevMiddleware) {
			this.setupWebpackDevMiddleware();
		}

		if (webpackHotMiddleware) {
			this.setupWebpackHotMiddleware();
		}

		this.config();
		this.checkProtocols(this.options.proxyUrl, this.options.target);
		this.emit('setup', this, this.watcherConfig);
	}

	/**
	 * Setup webpackDevMiddleware
	 * @public
	 */
	setupWebpackDevMiddleware() {
		const devMiddlewareConfig = merge(
			{
				publicPath:
					this.options.publicPath ||
					this.compiler.options.output.publicPath,
				// noInfo: true,
			},
			this.compiler.options.devServer,
			this.options.advanced.webpackDevMiddleware
		);

		try {
			this.webpackDevMiddleware = webpackDevMiddleware(
				this.compiler,
				devMiddlewareConfig
			);

			this.middleware.push(this.webpackDevMiddleware);
		} catch (e) {
			console.error(`webpackDevMiddleware init error: `, e);
		}
	}

	/**
	 * Setup webpackHotMiddleware
	 * @public
	 */
	setupWebpackHotMiddleware() {
		this.webpackHotMiddleware = webpackHotMiddleware(
			this.compiler,
			merge(
				{
					log: this.watcher.notify.bind(
						this.watcher
					),
				},
				this.options.advanced.webpackHotMiddleware
			)
		);
		this.middleware.push(this.webpackHotMiddleware);
	}

	/**
	 * Generate config for BrowserSync.
	 * @private
	 */
	config() {
		const watchOptions = merge(
			{ ignoreInitial: true },
			this.getPollOptions()
		);
		const reloadDebounce =
			this.options.debounce ||
			watchOptions.aggregateTimeout ||
			0;
		this.watcherConfig = merge(
			{
				open: this.options.open,
				host: url.parse(this.options.proxyUrl).hostname,
				port: url.parse(this.options.proxyUrl).port,
				proxy: {
					target: this.options.target,
					middleware: this.middleware,
				},
				rewriteRules: [
					{
						match: /<\/head>/i,
						fn: (req, res, match) => {
							if (
								!this
									.webpackAssetUrls ||
								!this
									.webpackAssetUrls
									.length
							) {
								return match;
							}

							const assetTags = [];

							if (res.data) {
								this.webpackAssetUrls.forEach(
									assetUrl => {
										if (
											!isAssetPresent(
												res.data,
												assetUrl
											)
										) {
											assetTags.push(
												assetTag(
													assetUrl
												)
											);
										}
									}
								);
							}

							return (
								assetTags.join(
									'\n'
								) + match
							);
						},
					},
				],
				files:
					!this.useHtmlInjector() &&
					this.options.watch
						? Array.isArray(
								this.options.watch
							)
							? uniq(this.options.watch)
							: [this.options.watch]
						: [],
				reloadDebounce,
				watchOptions,
			},
			this.options.advanced.browserSync
		);
	}

	getPollOptions() {
		const watchOptions = this.getWatchOptions();
		const polling = watchOptions.poll || false;
		const usePolling = Boolean(polling);
		const interval = polling === usePolling ? 100 : polling;
		return {
			interval,
			usePolling,
			binaryInterval: Math.min(interval * 3, interval + 200),
		};
	}

	/**
	 * Get watchOptions from webpack
	 */
	getWatchOptions() {
		const options = this.compiler.options;
		const webpackWatchOptions = options.watchOptions || {};
		const devServerWatchOptions =
			(options.devServer
				? options.devServer.watchOptions
				: {}) || {};
		return merge(webpackWatchOptions, devServerWatchOptions);
	}

	/**
	 * Use htmlInjector
	 */
	useHtmlInjector() {
		return htmlInjector !== undefined;
	}

	/**
	 * Check protocols of both proxy and target URLs
	 */
	checkProtocols(proxyUrl, targetUrl) {
		if (!(proxyUrl && targetUrl)) {
			return;
		}
		const proxyUrlProtocol = url
			.parse(proxyUrl)
			.protocol.slice(0, -1);
		const targetUrlProtocol = url
			.parse(targetUrl)
			.protocol.slice(0, -1);
		if (proxyUrlProtocol !== targetUrlProtocol) {
			console.warn(
				'Mismatched protocols. Things might not work right.'
			);
			console.warn(
				`Your proxy uses the protocol: ${proxyUrlProtocol}`
			);
			console.warn(
				`Your target uses the protocol: ${targetUrlProtocol}`
			);
		}
	}
};
