use std::{env, fs, process};

use dolby_vision::rpu::dovi_rpu::DoviRpu;

fn main() {
    if let Err(error) = run() {
        eprintln!("AV1 T.35 RPU conversion failed: {error:#}");
        process::exit(1);
    }
}

fn run() -> anyhow::Result<()> {
    let mut args = env::args().skip(1);
    let input = args.next().ok_or_else(|| anyhow::anyhow!("missing input path"))?;
    let output = args.next().ok_or_else(|| anyhow::anyhow!("missing output path"))?;
    let mut reference = None;
    let mut regular_output = false;
    for argument in args {
        if argument == "--regular" {
            if regular_output {
                anyhow::bail!("duplicate --regular option");
            }
            regular_output = true;
        } else if reference.is_none() {
            reference = Some(argument);
        } else {
            anyhow::bail!("unexpected extra arguments");
        }
    }
    if regular_output && reference.is_some() {
        anyhow::bail!("--regular cannot be combined with a NAL reference file");
    }

    let payload = fs::read(input)?;
    let parsed = DoviRpu::parse_itu_t35_dovi_metadata_obu(&payload)?;
    let profile = parsed.dovi_profile;
    let output_bytes = if regular_output {
        parsed.write_rpu()?
    } else {
        parsed.write_hevc_unspec62_nalu()?
    };
    let last_nonzero = output_bytes.iter().rposition(|byte| *byte != 0);
    let valid_output = if regular_output {
        output_bytes.len() >= 7 && output_bytes[0] == 0x19
    } else {
        output_bytes.len() >= 27 && output_bytes.starts_with(&[0x7c, 0x01])
    };
    if !valid_output || last_nonzero.map(|index| output_bytes[index]) != Some(0x80) {
        anyhow::bail!("libdovi returned an invalid RPU output");
    }
    if let Some(reference_path) = reference {
        let nalu = output_bytes.as_slice();
        // Match dovi_tool's own AV1 fixture contract: upstream reference is
        // Annex-B (4-byte start code + 2-byte HEVC NAL header), while the
        // serializer returns the HEVC NAL unit without the start code.
        let expected = fs::read(reference_path)?;
        if expected.get(4..) != nalu.get(2..) {
            anyhow::bail!("AV1 T.35 RPU does not match the upstream HEVC RPU reference");
        }
    }
    fs::write(output, &output_bytes)?;
    println!(
        "{{\"profile\":{profile},\"rpuByteLength\":{}}}",
        output_bytes.len()
    );
    Ok(())
}
