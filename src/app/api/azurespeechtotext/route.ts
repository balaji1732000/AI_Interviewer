export async function POST(req: Request) {
  try {
      const formData = await req.formData();
      const file = formData.get("file") as File; 
      const lang = formData.get("lang") as string;
      let token = formData.get("token") as string;

      if (!token || token === "null" && !process.env.AZURE_OPENAI_KEY) {
          return {
              error: "No API key provided.",
          };
      }

      // Create form data to send file to Azure OpenAI
      let data = new FormData();
      data.append("file", file, "audio.webm");

      // Azure OpenAI endpoint
      let endpoint = `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/MyDeploymentName/audio/transcriptions?api-version=2023-09-01-preview`;

      // Make the API request
      let response = await fetch(endpoint, {
          method: 'POST',
          headers: {
              'api-key': process.env.AZURE_OPENAI_KEY
          },
          body: data
      });

      // Check if request was successful
      if (!response.ok) {
          throw new Error(`API request failed: ${response.statusText}`);
      }

      // Parse the response
      let result = await response.json();

      // Return the result
      return result;

  } catch (error) {
      console.error(error);
      return {
          error: 'Server error',
      };
  }
}


//Webm is not supported in azure speech sdk,But silence aware recorder user MediaRecorderAPI in the backend Which always provides webm output. 
//So, wav or PCM format only supported if convert the format from Webm to wav.
//one solution is azure openAI whispermodel that helps us to transcribe the any audio format even webm. we can do rest call.