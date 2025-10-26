import { Dimensions } from '../../../src/models';
import { convertDimensionsToDimensionArray } from '../../../src/utilities';

describe('utilities', () => {
  test('convertDimensionsToDimensionArray_emptyDimension_shouldSucceed', () => {
    const dimensionArr = convertDimensionsToDimensionArray({});
    expect(dimensionArr.length).toStrictEqual(0);
  });

  test('convertDimensionsToDimensionArray_singleDimension_shouldSucceed', () => {
    const dimensions: Dimensions = {
      OrderType: 'OrderTypeValue',
    };
    const dimensionArr = convertDimensionsToDimensionArray(dimensions);
    expect(dimensionArr.length).toStrictEqual(1);
    expect(dimensionArr[0].key).toStrictEqual('OrderType');
    expect(dimensionArr[0].value).toStrictEqual('OrderTypeValue');
  });

  test('convertDimensionsToDimensionArray_multipleDimensions_shouldSucceed', () => {
    const dimensions: Dimensions = {
      OrderType: 'OrderTypeValue',
      Symbol: 'S',
    };
    const dimensionArr = convertDimensionsToDimensionArray(dimensions);
    expect(dimensionArr.length).toStrictEqual(2);
    dimensionArr.sort((d1, d2) => d1.key.localeCompare(d2.key));
    expect(dimensionArr[0].key).toStrictEqual('OrderType');
    expect(dimensionArr[0].value).toStrictEqual('OrderTypeValue');
    expect(dimensionArr[1].key).toStrictEqual('Symbol');
    expect(dimensionArr[1].value).toStrictEqual('S');
  });
});
