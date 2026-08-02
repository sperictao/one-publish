import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProviderParameterFormSections } from "../ProviderParameterFormSections";
import type { ParameterSchema } from "@/types/parameters";

const schema: ParameterSchema = {
  parameters: {
    target: {
      type: "string",
      flag: "--target",
      description: "Target triple",
    },
    release: {
      type: "boolean",
      flag: "--release",
      description: "Release build",
    },
    features: {
      type: "array",
      flag: "--features",
      description: "Feature list",
    },
  },
};

describe("ProviderParameterFormSections", () => {
  it("renders one field per schema parameter with current values", () => {
    render(
      <ProviderParameterFormSections
        schema={schema}
        parameters={{ target: "aarch64-apple-darwin", release: true }}
        onParameterChange={vi.fn()}
      />
    );

    expect(screen.getByLabelText("target")).toHaveValue("aarch64-apple-darwin");
    expect(screen.getByLabelText("release")).toBeChecked();
    expect(screen.getByText("features")).toBeInTheDocument();
  });

  it("reports edits keyed by schema parameter name", () => {
    const handleChange = vi.fn();
    render(
      <ProviderParameterFormSections
        schema={schema}
        parameters={{}}
        onParameterChange={handleChange}
      />
    );

    fireEvent.change(screen.getByLabelText("target"), {
      target: { value: "x86_64-pc-windows-msvc" },
    });

    expect(handleChange).toHaveBeenCalledWith(
      "target",
      "x86_64-pc-windows-msvc"
    );
  });

  it("blocks edits in readonly mode", () => {
    const handleChange = vi.fn();
    render(
      <ProviderParameterFormSections
        mode="readonly"
        schema={schema}
        parameters={{ release: true }}
        onParameterChange={handleChange}
      />
    );

    fireEvent.click(screen.getByLabelText("release"));

    expect(handleChange).not.toHaveBeenCalled();
  });

  it("shows a loading hint until the schema arrives", async () => {
    render(<ProviderParameterFormSections parameters={{}} />);

    expect(
      await screen.findByText(
        /参数定义加载中|Loading parameter definitions|providerParametersSchemaLoading/
      )
    ).toBeInTheDocument();
  });
});
