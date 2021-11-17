import {ExecaChildProcess} from 'execa';
import fs from 'fs';
import path from 'path';
import type {Browser as PuppeteerBrowser} from 'puppeteer-core';
import {
	Browser,
	Codec,
	FfmpegExecutable,
	FrameRange,
	Internals,
	PixelFormat,
	ProResProfile,
	TCompMetadata,
} from 'remotion';
import {stitchFramesToVideo, spawnFfmpeg} from './stitcher';
import {renderFrames} from './render';
import {BrowserLog} from './browser-log';
import {OnStartData} from './types';
import {RenderInternals} from '.';
import {makeAssetsDownloadTmpDir} from './make-assets-download-dir';

export type RenderMediaOnDownload = (src: string) => void;

export type StitchingState = 'encoding' | 'muxing';

export type RenderMediaOnProgress = (progress: {
	renderedFrames: number;
	encodedFrames: number;
	encodedDoneIn: number | null;
	renderedDoneIn: number | null;
	stitchStage: StitchingState;
}) => void;

export type RenderMediaOptions = {
	proResProfile: ProResProfile | undefined;
	parallelism: number | null;
	parallelEncoding: boolean;
	crf: number | null;
	outputDir: string;
	config: TCompMetadata;
	imageFormat: 'png' | 'jpeg' | 'none';
	ffmpegExecutable: FfmpegExecutable;
	inputProps: unknown;
	pixelFormat?: PixelFormat;
	codec: Codec;
	envVariables?: Record<string, string>;
	quality: number | undefined;
	frameRange: FrameRange | null;
	browser: Browser;
	serveUrl: string;
	openedBrowser: PuppeteerBrowser;
	overwrite: boolean;
	absoluteOutputFile: string;
	onProgress?: RenderMediaOnProgress;
	onDownload: (src: string) => void;
	dumpBrowserLogs: boolean;
	onBrowserLog?: ((log: BrowserLog) => void) | undefined;
	onStart: (data: OnStartData) => void;
	downloadDir?: string;
};

// TODO: outputDir and `absoluteOutputFile` are redundant
export const renderMedia = async ({
	parallelism,
	proResProfile,
	parallelEncoding,
	crf,
	outputDir,
	config,
	imageFormat,
	ffmpegExecutable,
	inputProps,
	pixelFormat,
	codec,
	envVariables,
	quality,
	frameRange,
	browser,
	serveUrl,
	openedBrowser,
	absoluteOutputFile,
	onProgress,
	overwrite,
	onDownload,
	dumpBrowserLogs,
	onBrowserLog,
	onStart,
	downloadDir: userDownloadDir,
}: RenderMediaOptions) => {
	let stitchStage: StitchingState = 'encoding';
	let stitcherFfmpeg: ExecaChildProcess<string> | undefined;
	let preStitcher;
	let encodedFrames = 0;
	let renderedFrames = 0;
	let preEncodedFileLocation: string | undefined;
	let renderedDoneIn: number | null = null;
	let encodedDoneIn: number | null = null;
	const renderStart = Date.now();

	const callUpdate = () => {
		onProgress?.({
			encodedDoneIn,
			encodedFrames,
			renderedDoneIn,
			renderedFrames,
			stitchStage,
		});
	};

	const downloadDir = userDownloadDir ?? (await makeAssetsDownloadTmpDir());

	if (parallelEncoding) {
		if (typeof crf !== 'number') {
			throw new TypeError('CRF is unexpectedly not a number');
		}

		preEncodedFileLocation = path.join(
			outputDir,
			'pre-encode.' + RenderInternals.getFileExtensionFromCodec(codec, 'chunk')
		);

		preStitcher = await spawnFfmpeg({
			dir: outputDir,
			width: config.width,
			height: config.height,
			fps: config.fps,
			outputLocation: preEncodedFileLocation,
			force: true,
			pixelFormat,
			codec,
			proResProfile,
			crf,
			onProgress: (frame: number) => {
				encodedFrames = frame;
				callUpdate();
			},
			verbose: Internals.Logging.isEqualOrBelowLogLevel('verbose'),
			parallelEncoding,
			ffmpegExecutable,
			assetsInfo: null,
			downloadDir,
		});
		stitcherFfmpeg = preStitcher.task;
	}

	const {assetsInfo} = await renderFrames({
		config,
		onFrameUpdate: (frame: number) => {
			renderedFrames = frame;
			callUpdate();
		},
		parallelism,
		outputDir,
		onStart: (data) => {
			renderedFrames = 0;
			callUpdate();
			onStart(data);
		},
		inputProps,
		envVariables,
		imageFormat,
		quality,
		browser,
		frameRange: frameRange ?? null,
		puppeteerInstance: openedBrowser,
		writeFrame: async (buffer) => {
			stitcherFfmpeg?.stdin?.write(buffer);
		},
		serveUrl,
		dumpBrowserLogs,
		onBrowserLog,
		downloadDir,
		onDownload,
	});
	if (stitcherFfmpeg) {
		stitcherFfmpeg?.stdin?.end();
		await stitcherFfmpeg;
		preStitcher?.cleanup?.();
	}

	const closeBrowserPromise = openedBrowser.close();
	renderedDoneIn = Date.now() - renderStart;
	callUpdate();

	if (typeof crf !== 'number') {
		throw new TypeError('CRF is unexpectedly not a number');
	}

	const dirName = path.dirname(absoluteOutputFile);

	if (!fs.existsSync(dirName)) {
		fs.mkdirSync(dirName, {
			recursive: true,
		});
	}

	const stitchStart = Date.now();
	await stitchFramesToVideo({
		dir: outputDir,
		width: config.width,
		height: config.height,
		fps: config.fps,
		outputLocation: absoluteOutputFile,
		preEncodedFileLocation,
		force: overwrite,
		pixelFormat,
		codec,
		proResProfile,
		crf,
		assetsInfo,
		ffmpegExecutable,
		onProgress: (frame: number) => {
			stitchStage = 'muxing';
			encodedFrames = frame;
			callUpdate();
		},
		onDownload,
		verbose: Internals.Logging.isEqualOrBelowLogLevel('verbose'),
		parallelEncoding: false,
		downloadDir,
	});
	encodedFrames = config.durationInFrames;
	encodedDoneIn = Date.now() - stitchStart;
	callUpdate();
	// TODO: Cleanup
	await closeBrowserPromise;
};