import {lambdaInitializedKey} from '../constants';
import {streamToString} from '../helpers/stream-to-string';
import {lambdaLs, lambdaReadFile} from '../io';
import {ChunkTimingData} from './types';

export const collectChunkInformation = async (
	bucketName: string,
	renderId: string
) => {
	const files = await lambdaLs({
		bucketName,
		forceS3: true,
	});
	const timingFiles = files.filter((f) =>
		f.Key?.startsWith(lambdaInitializedKey(renderId))
	);
	const timingFileContents = await Promise.all(
		timingFiles.map(async (file) => {
			const contents = await lambdaReadFile({
				bucketName,
				key: file.Key as string,
			});
			const string = await streamToString(contents);
			return JSON.parse(string) as ChunkTimingData;
		})
	);
	return timingFileContents;
};