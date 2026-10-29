export class RecordNotFoundError extends Error {
  constructor(what: string, id: string) {
    super(`${what} not found: ${id}`);
    this.name = 'RecordNotFoundError';
  }
}

/** `holderName` is the live product that has the barcode, so the message can name it. */
export class DuplicateBarcodeError extends Error {
  readonly barcode: string;
  readonly holderName: string;

  constructor(barcode: string, holderName: string) {
    super(`Barcode already in use: ${barcode} (${holderName})`);
    this.name = 'DuplicateBarcodeError';
    this.barcode = barcode;
    this.holderName = holderName;
  }
}

export class DuplicateCategoryError extends Error {
  constructor(name: string) {
    super(`Category name already in use: ${name}`);
    this.name = 'DuplicateCategoryError';
  }
}

export class PaymentMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentMismatchError';
  }
}

export class CreditLimitError extends Error {
  constructor(customerId: string, limit: number, balanceAfter: number) {
    super(`Customer ${customerId} would owe ${balanceAfter}, above the limit of ${limit}`);
    this.name = 'CreditLimitError';
  }
}

export class SaleVoidedError extends Error {
  constructor(receiptNo: string) {
    super(`Sale already voided: ${receiptNo}`);
    this.name = 'SaleVoidedError';
  }
}

export class SaleReturnedError extends Error {
  constructor(receiptNo: string) {
    super(`Sale has returns and cannot be voided: ${receiptNo}`);
    this.name = 'SaleReturnedError';
  }
}

export class ReturnExceedsSaleError extends Error {
  constructor(receiptNo: string, productId: string) {
    super(`Return exceeds what was sold on ${receiptNo} for product ${productId}`);
    this.name = 'ReturnExceedsSaleError';
  }
}
