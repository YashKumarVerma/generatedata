import { DTDefinition, DTBundle } from '../../../../types/dataTypes';
import { Help } from './GUID.ui';
import { generate, getMetadata } from './GUID.generate';

const definition: DTDefinition = {
	name: 'GUID',
	fieldGroup: 'numeric',
	fieldGroupOrder: 50
};

export default {
	definition,
	Help,
	generate,
	getMetadata
} as DTBundle;
