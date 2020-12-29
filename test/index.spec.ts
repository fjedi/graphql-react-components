import { getListKeyFromDataType } from '../src';

describe('Test graphql-react-components helpers', function () {
  it('Test "getListKeyFromDataType" function', async function () {
    const dataField1 = getListKeyFromDataType('NodeStatus');
    const dataField2 = getListKeyFromDataType('Company');

    expect(dataField1).toBe('getNodeStatuses');
    expect(dataField2).toBe('getCompanies');
  });
});
