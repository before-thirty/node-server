import axios from "axios";

export const getYoutubeMetadata = async (videoId: string, apiKey = process.env.GOOGLE_MAPS_API_KEY) => {
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${apiKey}`;
    const response = await axios.get(url);
    const snippet = response.data.items[0]?.snippet;

    console.log("Youtube Title", snippet?.title)
    console.log("Youtube Description", snippet?.description )
    return {
        title: snippet?.title,
        description: snippet?.description.length > 500 ? snippet?.description.substring(0, 500) : snippet?.description ?? ""
    }
}



export const getYouTubeVideoId = (url : string) => {
  let match = url.match(/(?:youtube\.com|m\.youtube\.com)\/watch.*[?&]v=([A-Za-z0-9_-]{11})/);
  if (match) return match[1];

  match = url.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  if (match) return match[1];

  match = url.match(/(?:youtube\.com|m\.youtube\.com)\/shorts\/([A-Za-z0-9_-]{11})/);
  if (match) return match[1];

  match = url.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{11})/);
  if (match) return match[1];

  match = url.match(/youtube\.com\/(?:v|e)\/([A-Za-z0-9_-]{11})/);
  if (match) return match[1];

  return null;
}
