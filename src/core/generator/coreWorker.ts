// this is the main generator web worker file for the Core script. It's used for generating the entire data set.
// right now it's es5. SUUUUURE be nice to at least use es6 if not TS

// import { GenerationProps, GenerationTemplate, GenerationTemplateRow } from "../../../types/general";
// import { DTGenerateResult, DTGenerationExistingRowData } from "../../../types/dataTypes";

import { DataTypeFolder } from '../../_plugins';

let workerResources: any;
let loadedDataTypeWorkers: any = {};
let dataTypeWorkerMap: any = {};
const workerQueue: any = {};

onmessage = function (e) {
	workerResources = e.data.workerResources;
	dataTypeWorkerMap = workerResources.dataTypes;

	// load the Data Type generator web worker files. Pretty sure this caches them so we can safely import them
	// every time
	Object.keys(dataTypeWorkerMap).forEach((dataType) => {
		if (!loadedDataTypeWorkers[dataType]) {
			loadedDataTypeWorkers[dataType] = new Worker(dataTypeWorkerMap[dataType])
		}
	});

	// load main utils file
	// importScripts("./" + dataTypes[folder]);

	// this would just keep looping like a crazy person. Every completed batch would be posted back to the parent script
	generateBatch(e.data);
};


const generateBatch = (data: any): Promise<any> => {
	return new Promise((resolve) => {
		const generationTemplate = data.template;

		// for the preview panel we always generate the max num of preview panel rows so when the user changes the
		// visible rows the data's already there
		const lastRowNum = 100; // data.numResults;
		const rowPromises = [];

		// rows are independent! The only necessarily synchronous bit is between process batches. So here we just run
		// them all in a loop
		for (let rowNum=1; rowNum<=lastRowNum; rowNum++) {
			let currRowData: any[] = [];
			rowPromises.push(processBatchSequence(generationTemplate, rowNum, data.i18n, currRowData));
		}

		Promise.all(rowPromises)
			.then((data) => {
				console.log("Final batch of data: ", data);
				resolve(data);
			});
	});
};

const processBatchSequence = (generationTemplate: any, rowNum: number, i18n: any, currRowData: any[]) => {
	const processBatches = Object.keys(generationTemplate);

	return new Promise((resolveAll) => {
		let sequence = Promise.resolve();

		// process each batch sequentially. This ensures the data generated from one processing batch is available to any
		// dependent children. For example, the Region data type needs the Country data being generated first so it
		// knows what country regions to generate if a mapping had been selected in the UI
		processBatches.forEach((processBatchNumberStr, batchIndex) => {
			const processBatchNum = parseInt(processBatchNumberStr, 10);
			const currBatch = generationTemplate[processBatchNum];

			// yup. We're mutating the currRowData param on each loop. We don't care hhahaha!!! Up yours, linter!
			sequence = sequence
				.then(() => processDataTypeBatch(currBatch, rowNum, i18n, currRowData))
				.then((promises) => {
					// this bit's sneaky. It ensures that the CURRENT batch within the row being generated is fully processed
					// before starting the next. That way, the generated data from earlier batches is available to later
					// Data Types
					return new Promise((resolveBatch) => {
						Promise.all(promises)
							.then((singleBatchResponses: any) => {
								for (let i=0; i<singleBatchResponses.length; i++) {
									currRowData.push({
										id: currBatch[i].id,
										colIndex: currBatch[i].colIndex,
										dataType: currBatch[i].dataType,
										data: singleBatchResponses[i]
									});
								}
								resolveBatch();

								if (batchIndex === processBatches.length-1) {
									currRowData.sort((a, b) =>a.colIndex < b.colIndex ? -1 : 1);
									resolveAll(currRowData.map((row) => row.data.display));
								}
							});
					});
				});
		});

	});
};

const processDataTypeBatch = (cells: any[], rowNum: number, i18n: any, currRowData: any): Promise<any>[] => (
	cells.map((currCell: any) => {
		let dataType = currCell.dataType;

		return new Promise((resolve, reject) => {
			queueJob(dataType, {
				rowNum: rowNum,
				i18n: i18n.dataTypes[dataType],
				countryI18n: i18n.countries,
				rowState: currCell.rowState,
				existingRowData: currRowData,
				workerResources: {
					coreUtils: workerResources.coreUtils
				}
			}, resolve, reject);
		});
	})
);


const queueJob = (dataType: DataTypeFolder, payload: any, resolve: any, reject: any) => {
	if (!workerQueue[dataType]) {
		workerQueue[dataType] = {
			processing: false,
			queue: []
		};
	}

	workerQueue[dataType].queue.push({
		payload,
		resolve,
		reject
	});

	processQueue(dataType);
};


const processQueue = (dataType: DataTypeFolder) => {
	if (workerQueue[dataType].processing) {
		return;
	}
	const queue = workerQueue[dataType].queue;
	const worker = loadedDataTypeWorkers[dataType];

	if (!queue.length) {
		return;
	}

	workerQueue[dataType].processing = true;
	const { payload, resolve, reject } = queue[0];

	worker.postMessage(payload);

	// Data Type generator functions can be sync or async, depending on their needs. This method calls the generator
	// method for all data types in a particular process batch and returns an array of promises, which when resolved,
	// returning the generated data for that row
	worker.onmessage = (response: any) => {
		if (typeof response.then === 'function') {
			// TODO
			//response.then()
		} else {
			resolve(response.data);
			processNextItem(dataType);
		}
	};

	worker.onerror = (resp: any) => {
		reject(resp);
		processNextItem(dataType);
	};
};

const processNextItem = (dataType: DataTypeFolder) => {
	workerQueue[dataType].queue.shift();
	workerQueue[dataType].processing = false;
	processQueue(dataType);
};