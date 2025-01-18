import express, { Request, Response } from "express";
import bodyParser from "body-parser";
import { extractLocationAndClassify } from "./openaiService";
import { AxiosRequestConfig } from "axios";
import parser from "html-metadata-parser";
import { getCoordinatesFromPlaceId, getPlaceId } from "./googlePlacesService";
import dotenv from "dotenv";
dotenv.config();

const app = express();
const PORT = 3000;

const axiosConfig: AxiosRequestConfig = {
  headers: {
    "Accept-Encoding": "gzip,deflate,br",
  },
  method: "GET",
};

const getMetadata = async (url: string) => {
  try {
    const result = await parser(url);
    return result;
  } catch (err) {
    console.error("Error parsing metadata:", err);
    return null;
  }
};

// Middleware
app.use(bodyParser.json());

app.get("/process", async (req: Request, res: Response) => {
  try {
    const url = req.query.url as string;
    if (!url) {
      res.status(400).json({ error: "URL is required" });
    }
    const metadata = await getMetadata(url);

    const description = metadata?.meta.description;

    if (!description) {
      res
        .status(404)
        .json({ error: "Could not fetch metadata for the given URL" });
    }

    const analysis = await extractLocationAndClassify(description ?? "");

    const placeId = await getPlaceId(analysis.location ?? "");

    const coordinates = await getCoordinatesFromPlaceId(placeId);

    const response = { ...analysis, coordinates };

    res.status(200).json({ response });
  } catch (error) {
    console.error("Error in /metadata endpoint:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Endpoint to process captions
app.post("/analyze-caption", async (req: Request, res: Response) => {
  const { caption } = req.body;

  if (!caption) {
    res.status(400).json({ error: "Caption is required." });
  }

  try {
    const analysis = await extractLocationAndClassify(caption);
    res.json(analysis);
  } catch (error) {
    console.error("Error processing caption:", error);
    res.status(500).json({ error: "Failed to process caption." });
  }
});

app.get("/place-id", async (req: Request, res: Response) => {
  try {
    const placeQuery = req.query.placeQuery as string;
    if (!placeQuery) {
      res.status(400).json({ error: "placeQuery is required" });
    }

    const placeId = await getPlaceId(placeQuery);
    res.status(200).json({ placeId });
  } catch (error) {
    console.error("Error in /place-id endpoint:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get("/coordinates", async (req: Request, res: Response) => {
  try {
    const placeId = req.query.placeid as string;
    if (!placeId) {
      res.status(400).json({ error: "placeQuery is required" });
    }

    const coordinates = await getCoordinatesFromPlaceId(placeId);
    res.status(200).json({ coordinates });
  } catch (error) {
    console.error("Error in /coordinates-from-placeid endpoint:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get("/metadata", async (req: Request, res: Response) => {
  try {
    const url = req.query.url as string;
    if (!url) {
      res.status(400).json({ error: "URL is required" });
    }
    const metadata = await getMetadata(url);

    const description = metadata?.meta.description;

    if (!metadata) {
      res
        .status(404)
        .json({ error: "Could not fetch metadata for the given URL" });
    }
    res.status(200).json({ metadata });
  } catch (error) {
    console.error("Error in /metadata endpoint:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
