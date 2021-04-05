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

  get items() {
    return [...this];
  }

  toJSON(this: CollectionResult<T>) {
    return {
      _url: this.url,
      _links: this.links,
      _type: this.type,
      page: this.page,
      limit: this.limit,
      hasMore: this.hasMore,
      items: this.items,
    };
  }
}

export class ChangeResult<T> implements ToJSON {
  id: string;
  item: T;
  changes: ChangeSummary<T>[];

  constructor(id: string, item: T, changes: ChangeSummary<T>[]) {
    this.id = id;
    this.item = item;
    this.changes = changes;
  }

  toJSON(this: ChangeResult<T>) {
    return {
      changeId: this.id,
      item: this.item,
      changes: this.changes,
    };
  }
}
