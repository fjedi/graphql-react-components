import { getListKeyFromDataType, getDataFromResponse } from '../src';

const TEST_ROWS_WITH_DATA = { rows: ['someData'], count: 1 };

describe('Test graphql-react-components helpers', function () {
  it('Test "getListKeyFromDataType" function', async function () {
    const dataField1 = getListKeyFromDataType('NodeStatus');
    const dataField2 = getListKeyFromDataType('Company');

    expect(dataField1).toBe('getNodeStatuses');
    expect(dataField2).toBe('getCompanies');
  });

  it('Test "getDataFromResponse" function', async function () {
    const data1 = getDataFromResponse('NodeStatus')({
      // @ts-ignore
      getNodeStatuses: TEST_ROWS_WITH_DATA,
    });
    const data2 = getDataFromResponse('NodeStatus')({
      // @ts-ignore
      getNodeStatusList: TEST_ROWS_WITH_DATA,
    });
    const data3 = getDataFromResponse('Company')({
      // @ts-ignore
      getCompanies: TEST_ROWS_WITH_DATA,
    });

    expect(data1?.rows?.[0]).toBe(TEST_ROWS_WITH_DATA.rows[0]);
    expect(data2?.rows?.[0]).toBe(TEST_ROWS_WITH_DATA.rows[0]);
    expect(data3?.rows?.[0]).toBe(TEST_ROWS_WITH_DATA.rows[0]);
  });
});
