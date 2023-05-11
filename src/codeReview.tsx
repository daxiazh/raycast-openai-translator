import {
  Action,
  ActionPanel,
  Detail,
  LaunchProps,
  Toast,
  getPreferenceValues,
  getSelectedText,
  showToast,
} from "@raycast/api";
import { useEffect, useRef, useState } from "react";
import { fetchSSE } from "./providers/openai/utils";

export interface CodeReviewQuery {
  onMessage: (message: { content: string; role: string }) => void;
  onError: (error: string) => void;
  onFinish: (reason: string) => void;
}

/**
 * 通过 ChatGPT 自动审核选中的代码段, 并给出反馈
 * @param props
 * @returns
 */
export default function Command(props: LaunchProps) {
  // 定义审核的代码
  const [reviewedCode, setReviewedText] = useState<string>("");

  const pageInfo = useRef({
    isReviewing: true, // 是否正在 Code Review
  });

  const splitter = "### ---------";

  useEffect(() => {
    (async () => {
      try {
        await showToast({
          title: "正在审核代码 ...",
          style: Toast.Style.Animated,
        });

        const selectedText = (await getSelectedText()).trim();
        if (selectedText.length == 0) {
          pageInfo.current.isReviewing = false;

          await showToast({
            style: Toast.Style.Failure,
            title: "审核失败",
            message: "没有选中代码段",
          });

          return;
        }

        let allReviewedCode = `## 审查代码\n\`\`\`\n${selectedText}\n\n\`\`\`\n\n----  \n${splitter}  \n`;
        setReviewedText(allReviewedCode);

        const query = {
          onMessage: (message: any) => {
            if (message.role) {
              return;
            }

            allReviewedCode += message.content;
            console.log("code review: " + allReviewedCode);
            setReviewedText(allReviewedCode);
          },
          onFinish: (reason: string) => {
            pageInfo.current.isReviewing = false;
            showToast({
              title: "审核完成",
              style: Toast.Style.Success,
            });
          },
          onError: (error: any) => {
            showToast({
              style: Toast.Style.Failure,
              title: "审核失败",
              message: error,
            });
          },
        };

        // 开始代码审核
        await chatGPTCodeReview(selectedText, query);
      } catch (error) {
        await showToast({
          style: Toast.Style.Failure,
          title: "审核失败",
          message: String(error),
        });
      }
    })();
  }, [pageInfo]);

  return (
    <Detail
      markdown={reviewedCode}
      actions={
        <ActionPanel>
          <Action.CopyToClipboard
            content={reviewedCode.slice(reviewedCode.indexOf(splitter) + splitter.length)}
            shortcut={{ modifiers: ["cmd"], key: "." }}
          />
        </ActionPanel>
      }
    />
  );
}

/**
 * 通过 ChatGPT 来审核代码
 * @param code 指定要审核的代码
 */
async function chatGPTCodeReview(code: string, query: CodeReviewQuery): Promise<void> {
  const { entrypoint, apikey, apiModel } = getPreferenceValues<{
    entrypoint: string;
    apikey: string;
    apiModel: string;
  }>();

  const systemPrompt =
    "Analyze the given code for code smells and suggest improvements, you can only response on markdown format. response in chinese.";
  const assistantPrompt = `
描述：
Code Review是指对代码进行全面的检查和评审，旨在发现潜在的问题、提高代码质量和可维护性，以及促进团队成员之间的知识分享和合作。在进行Code Review时，需要注意以下几个方面：

1. 代码逻辑和功能是否正确实现
2. 代码是否符合编码规范和最佳实践
3. 是否存在潜在的安全漏洞和性能问题
4. 代码是否易于理解和维护
5. 是否有足够的注释
6. 以列表中的形式来描述每个问题
  `;

  const body = {
    model: apiModel,
    temperature: 0,
    max_tokens: 2000,
    top_p: 1,
    frequency_penalty: 1,
    presence_penalty: 1,
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "assistant",
        content: assistantPrompt,
      },
      { role: "user", content: `"${code}"` },
    ],
    stream: true,
  };

  const headers: Record<string, string> =
    apikey == "none"
      ? { "Content-Type": "application/json" }
      : { "Content-Type": "application/json", Authorization: `Bearer ${apikey}` };

  let isFirst = true;
  await fetchSSE(`${entrypoint}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    onMessage: (msg) => {
      let resp;
      try {
        resp = JSON.parse(msg);
        // eslint-disable-next-line no-empty
      } catch {
        //query.onFinish("stop");
        return;
      }
      const { choices } = resp;
      if (!choices || choices.length === 0) {
        return { error: "No result" };
      }
      const { delta, finish_reason: finishReason } = choices[0];
      if (finishReason) {
        query.onFinish(finishReason);
        return;
      }
      const { content = "", role } = delta;
      let targetTxt = content;

      if (isFirst && targetTxt && ["“", '"', "「"].indexOf(targetTxt[0]) >= 0) {
        targetTxt = targetTxt.slice(1);
      }

      if (!role) {
        isFirst = false;
      }

      query.onMessage({ content: targetTxt, role });
    },

    onError: (err) => {
      const { error } = err;
      query.onError(error.message);
    },
  });
}
