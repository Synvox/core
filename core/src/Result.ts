import { ChangeSummary } from "./types";

interface ToJSON {
  toJSON(): any;
}

const metaSym = Symbol();

type ResultMeta = {
  url: string;
  links: Record<string, string>;
  type: string;
};

export class Result<T extends Record<string, any>> implements ToJSON {
  private [metaSym]: ResultMeta;
  constructor(data: T, meta: ResultMeta) {
    Object.assign(this, data);
    this[metaSym] = meta;
  }

  toJSON() {
    const { [metaSym]: meta, ...others } = this;
    return {
      _url: this[metaSym].url,
      _links: this[metaSym].links,
      _type: this[metaSym].type,
      ...others,
    };
  }
}

type CollectionMeta = {
  page?: number;
  limit: number;
  hasMore: boolean;
  links: Record<string, string>;
  type: string;
  url: string;
};

export class CollectionResult<T extends Record<string, any>>
  extends Array<T>
  implements ToJSON {
  page?: number;
  limit: number;
  hasMore: boolean;
  links: Record<string, string>;
  type: string;
  url: string;

  constructor(data: T[], meta: CollectionMeta) {
    super(...data);
    this.page = meta.page;
    this.limit = meta.limit;
    this.hasMore = meta.hasMore;
    this.links = meta.links;
    this.type = meta.type;
    this.url = meta.url;
    Object.assign(this, meta);
  }

  get meta() {
    return {
      page: this.page,
      limit: this.limit,
      hasMore: this.hasMore,
      _links: this.links,
      _type: this.type,
      _url: this.url,
    };
  }

  get data() {
    return [...this];
  }

  toJSON(this: CollectionResult<T>) {
    return {
      meta: this.meta,
      data: this.data,
    };
  }
}

export class ChangeResult<T> implements ToJSON {
  data: T;
  changes: ChangeSummary<T>[];

  constructor(data: T, changes: ChangeSummary<T>[]) {
    this.data = data;
    this.changes = changes;
  }

  toJSON(this: ChangeResult<T>) {
    return {
      data: this.data,
      changes: this.changes,
    };
  }
}
