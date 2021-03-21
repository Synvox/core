import { createServer } from "http";
import express from "express";
import Axios from "axios";
import listen from "test-listen";
import { upload } from "../src";
import { BadRequestError } from "../src/errors";

const getSignedUrlMock = jest.fn();
const endpointMock = jest.fn();
jest.mock("aws-sdk", () => {
  return {
    S3: class S3 {
      getSignedUrl(
        name: string,
        params: any,
        callback: (err: null | Error, url?: string) => void
      ) {
        if (!params.Key)
          return callback(new BadRequestError({ error: "bad request" }));
        getSignedUrlMock(name, params);
        callback(null, "https://signed-url.com/asdf");
      }
    },
    Endpoint: class Endpoint {
      constructor(url: string) {
        endpointMock(url);
      }
    },
  };
});

it("handles file uploads", async () => {
  const app = express();

  app.use(express.json());
  app.use(
    "/upload",
    upload(
      async (_req, _res, getSignedUrl) => {
        const url = await getSignedUrl({
          fileName: "file",
          fileType: "test/plain",
        });

        return {
          id: 1,
          signedUrl: url,
        };
      },
      {
        S3_BUCKET: "BUCKET_NAME",
        endpointUrl: "https://s3.com",
      }
    )
  );

  const server = createServer(app);
  const url = await listen(server);
  const axios = Axios.create({ baseURL: url });

  const { data } = await axios.post("/upload").catch((e) => e.response);

  expect(getSignedUrlMock).toHaveBeenCalledWith("putObject", {
    Bucket: "BUCKET_NAME",
    Key: "file",
    Expires: 60,
    ContentType: "test/plain",
    ACL: "public-read",
  });

  expect(endpointMock).toHaveBeenCalledWith("https://s3.com");

  expect(data).toMatchInlineSnapshot(`
    Object {
      "id": 1,
      "signedUrl": "https://signed-url.com/asdf",
    }
  `);

  server.close();
});

it("handles file upload failure", async () => {
  const app = express();

  app.use(express.json());
  app.use(
    "/upload",
    upload(
      async (_req, _res, getSignedUrl) => {
        const url = await getSignedUrl({
          fileName: "",
          fileType: "test/plain",
        });

        return {
          id: 1,
          signedUrl: url,
        };
      },
      {
        S3_BUCKET: "BUCKET_NAME",
        endpointUrl: "https://s3.com",
      }
    )
  );

  const server = createServer(app);
  const url = await listen(server);
  const axios = Axios.create({ baseURL: url });

  const { status, data } = await axios.post("/upload").catch((e) => e.response);
  expect(status).toMatchInlineSnapshot(`400`);
  expect(data).toMatchInlineSnapshot(`
    Object {
      "error": "bad request",
    }
  `);

  server.close();
});
